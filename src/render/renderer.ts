/**
 * 遊戲 renderer：封閉賽道、追尾相機、圈數 HUD。
 *
 * ## R20：黏土地基接進遊戲
 *
 * R18／R19 做出了共用黏土地基與 `kart-body`／`kart-wheels`／`driver-face`
 * 三個元件，但只在 `BAR-VISUAL §3` 的拍攝台上單獨拍過，遊戲畫面跑的一直是
 * W1 的方塊車——`BAR-PERF` 量到的因此也是方塊車的成本，對 W3 沒有參考價值。
 * 這一版把地基接上：車換成 `components/kart.ts` 的整車，光照換成
 * `clay/lighting.ts` 的全域鑽機（`§5.0` 鐵律：全場同一套光）。
 *
 * **賽道／護欄／草地仍是 placeholder。** 元件 #4 `track-surface`、
 * #5 `track-barriers`、#6 `foliage` 都還沒實作（`components/registry.ts` 裡
 * 仍是 `create: null`）。這裡只把它們的材質換成共用黏土材質、顏色改用
 * `CHARACTERS.md §6` 的 token，幾何完全沒動——否則一台黏土車會站在
 * 三塊 Lambert 灰板上，光照鑽機的效果根本看不出來。**換材質不等於做完元件**：
 * 接縫、路緣石、草叢造型都還沒有，那些才是那三個元件的內容。
 *
 * 相機刻意偏離上游 Art Bible 的 3/4 diorama 規格，理由見 BAR-VISUAL.md §0.5：
 * 那是靜態島嶼插圖的視角，套在賽車上玩家會看不到前方賽道。
 */
import * as THREE from 'three';
import type { Renderer, SimSnapshot } from '@loader/bootstrap';
import { TRACK_GEOMETRY } from '@physics/constants';
import { exposeRenderTelemetry, renderTelemetry } from '@contract/render-telemetry';
import { createKart, type KartVisual } from './components/kart.js';
import { applyClayRenderSettings, createClayLighting, enableClayShadows } from './clay/lighting.js';
import { createTrackSurfaceRing } from './components/track-surface.js';
import { createClayMaterial } from './clay/material.js';
import { CAR_PARK, TERRAIN, XIAOHONG } from './clay/palette.js';

const CAMERA_FOV_DEG = 55;
const CAMERA_FOLLOW_DISTANCE = 8;
/** atan(2.1 / 8) ≈ 14.7°，落在 BAR-VISUAL §0.5 的 12–18° 規格內。 */
const CAMERA_FOLLOW_HEIGHT = 2.1;
const CAMERA_LOOK_AHEAD = 4;

/** 相機注視點的高度。整車原點在地面，車頂約 1.3，取一半略低處。 */
const CAMERA_LOOK_HEIGHT = 0.6;

/**
 * 場上多台車的識別色，全部取自 `clay/palette.ts` 的既有 token。
 *
 * 玩家永遠是小紅賽車的磚紅（`CHARACTERS.md §2` #1）。AI 對手**不是**換色的
 * 小紅賽車——其餘五位車手各有造型，那是之後的元件——這裡只是在造型做出來
 * 之前讓玩家分得出哪台是自己的。
 */
const AI_LIVERY = [CAR_PARK.accentBlue, CAR_PARK.accentGreen, CAR_PARK.accentLavender];

/** 最短路徑角度插值，避免 yaw 跨越 ±π 時畫面瞬間反向。 */
function lerpAngle(a: number, b: number, t: number): number {
  const twoPi = Math.PI * 2;
  let delta = (b - a) % twoPi;
  if (delta > Math.PI) delta -= twoPi;
  if (delta < -Math.PI) delta += twoPi;
  return a + delta * t;
}

function forwardVector(yaw: number): [number, number] {
  // 與 src/physics/world.ts 的慣例一致：forward = (sin(yaw), cos(yaw))。
  return [Math.sin(yaw), Math.cos(yaw)];
}

function formatTime(seconds: number): string {
  return seconds.toFixed(2) + 's';
}

class ClayRenderer implements Renderer {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 500);
  readonly #hud: HTMLDivElement;

  /**
   * 全域光照鑽機。每幀跟著玩家車移動——**這不是逐元件調光**（`§3` 禁的是
   * 那個），燈的參數一個都沒變，只是把整組平移過去。不跟著移動的話
   * `clay/lighting.ts` 的陰影 frustum（±9 單位）在車開離原點之後就框不到車，
   * 接地陰影會整個消失。
   */
  readonly #lighting = createClayLighting();

  /**
   * 每台車一組整車視覺，索引對齊 `snap.karts`。長度隨快照動態調整——
   * `draw()` 第一次看到某個索引時才建立，數量由呼叫端的
   * `createWorld()` options 決定，渲染層不假設固定車數。
   */
  #karts: KartVisual[] = [];
  #prevPos: Array<[number, number, number] | null> = [];
  #prevYaw: number[] = [];
  /** 每台車的累積滾動距離，用來驅動輪子自轉。 */
  #rolled: number[] = [];
  /** 上一次 `draw()` 看到的模擬時間，用來取得本幀的模擬 dt。 */
  #prevSimTime: number | null = null;

  constructor(mount: HTMLElement) {
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    applyClayRenderSettings(this.#renderer);
    mount.appendChild(this.#renderer.domElement);

    // 天空是元件 #7 `skybox-lighting` 的一部分，還沒實作——但 `§3` 的
    // `#8a8a8a` 中性灰是**拍攝台背景**，那是為了讓元件圖可比，不是遊戲場景
    // 該長的樣子。這裡放一格 `CHARACTERS.md §6` 的淺水藍當 placeholder，
    // 雲、漸層、天空球一個都沒有。
    this.#scene.background = new THREE.Color(TERRAIN.seaLight);
    this.#scene.add(this.#lighting);

    // `BAR-PERF §4` 的量測來源。掛在這裡而不是 `src/loader/`——那是 Cursor
    // 的範圍，而計數器是 render 端遞增的，掛載點跟遞增點放在一起比較不會漂。
    exposeRenderTelemetry();

    this.#buildGround();
    this.#buildTrack();
    this.#buildBoundaryWalls();

    this.#hud = document.createElement('div');
    this.#hud.style.cssText = [
      'position:absolute', 'top:12px', 'left:12px',
      'font:14px/1.4 monospace', 'color:#fff',
      'text-shadow:0 1px 2px rgba(0,0,0,.8)',
      'pointer-events:none', 'white-space:pre',
    ].join(';');
    mount.style.position ||= 'relative';
    mount.appendChild(this.#hud);
  }

  /**
   * 賽道外的大面積填充。**不是元件 #6 `foliage`**——草叢、樹木一個都沒有，
   * 只是一塊草色的地。材質改用共用黏土材質，才接得住全域光照的陰影。
   */
  #buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      // 大面積地面的壓痕要拉開，不然整片會變成細密雜訊（`§6` 禁止的那種）。
      createClayMaterial({ color: TERRAIN.grassMid, textureScale: 60 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01; // 避免與賽道面 z-fight
    ground.receiveShadow = true;
    this.#scene.add(ground);
  }

  /**
   * 賽道本體：`TRACK_GEOMETRY` 的半徑 ± 半寬，不是碰撞面。
   *
   * **這裡就是元件 #4 `track-surface`。** R23 之前這裡是一個 `RingGeometry`
   * 平環加手調的 `textureScale: 40`，兩個問題：`RingGeometry` 的 UV 是放射狀
   * 的 0..1，內圈周長 2π·24 與外圈 2π·36 差 50%，壓痕會被不均勻拉伸；而
   * `textureScale: 40` 換算下來一個壓痕循環約 1.8 世界單位，跟車身的 2.4
   * 對不齊——`§5.4` 的比例條款明文點名這是「最常見的破綻」。
   *
   * 現在改用 `createTrackSurfaceRing()`：UV 走真實弧長，路面高出草地形成
   * 看得到的接縫，兩側有奶油沙邊帶與中線虛線。
   */
  #buildTrack(): void {
    const surface = createTrackSurfaceRing(
      TRACK_GEOMETRY.radius,
      TRACK_GEOMETRY.halfWidth,
    );
    surface.position.set(TRACK_GEOMETRY.centerX, 0, TRACK_GEOMETRY.centerZ);
    this.#scene.add(surface);
  }

  /**
   * 視覺上的牆，畫在賽道邊界（radius ± halfWidth），不是往內縮車體半徑
   * 後的碰撞面——否則看起來會像「還沒碰到就彈開」。
   *
   * **不是元件 #5 `track-barriers`**——那個元件要的是護欄與路緣石造型，
   * 這裡只有一圈圓管。顏色換成 car-park 主題的品牌橘（`CHARACTERS.md §6`）。
   */
  #buildBoundaryWalls(): void {
    const wallHeight = 0.5;
    const wallThickness = 0.3;
    const material = createClayMaterial({ color: CAR_PARK.brandOrange, textureScale: 30 });

    for (const radius of [
      TRACK_GEOMETRY.radius - TRACK_GEOMETRY.halfWidth,
      TRACK_GEOMETRY.radius + TRACK_GEOMETRY.halfWidth,
    ]) {
      const wall = new THREE.Mesh(
        new THREE.TorusGeometry(radius, wallThickness / 2, 8, 96),
        material,
      );
      wall.rotation.x = Math.PI / 2;
      wall.position.set(TRACK_GEOMETRY.centerX, wallHeight, TRACK_GEOMETRY.centerZ);
      wall.receiveShadow = true;
      this.#scene.add(wall);
    }
  }

  /** 索引 i 的車若不存在就先建立——渲染層不預先假設車數。 */
  #ensureKart(i: number, isPlayer: boolean): KartVisual {
    let kart = this.#karts[i];
    if (kart) return kart;
    const bodyColor = isPlayer
      ? XIAOHONG.body
      : (AI_LIVERY[(i - 1 + AI_LIVERY.length) % AI_LIVERY.length] ?? CAR_PARK.accentBlue);
    kart = createKart({ bodyColor });
    enableClayShadows(kart.group);
    this.#scene.add(kart.group);
    this.#karts[i] = kart;
    this.#rolled[i] = 0;
    return kart;
  }

  draw(snap: SimSnapshot, alpha: number): void {
    // `BAR-PERF §4` 的分母。有它才分得開「抽格」與「慢」：
    // updates / renderedFrames 該是 1.0，與機器快慢無關。
    renderTelemetry.renderedFrames += 1;

    let playerIx = 0, playerIy = 0, playerIz = 0, playerIyaw = 0;

    // 本幀推進的模擬時間。輪子自轉吃距離、表情吃時間，兩者都要它。
    const simDt = this.#prevSimTime === null ? 0 : Math.max(0, snap.t - this.#prevSimTime);
    this.#prevSimTime = snap.t;

    for (const [i, kart] of snap.karts.entries()) {
      const visual = this.#ensureKart(i, i === snap.playerIndex);
      const [x, y, z] = kart.pos;
      const prev = this.#prevPos[i] ?? null;

      const ix = prev ? prev[0] + (x - prev[0]) * alpha : x;
      const iy = prev ? prev[1] + (y - prev[1]) * alpha : y;
      const iz = prev ? prev[2] + (z - prev[2]) * alpha : z;
      const iyaw = lerpAngle(this.#prevYaw[i] ?? kart.yaw, kart.yaw, alpha);

      // 整車原點就在車體正下方的地面（見 components/kart-body.ts），
      // 所以直接吃快照的 y，不再補半個車高。
      visual.group.position.set(ix, iy, iz);
      visual.group.rotation.y = iyaw;

      // `CHARACTERS.md §3`：輪子屬載具，60fps 不抽格。
      const rolled = (this.#rolled[i] ?? 0) + kart.speed * simDt;
      this.#rolled[i] = rolled;
      visual.setRolledDistance(rolled);
      visual.setSteerInput(kart.steerInput);

      // 同 §3：臉屬純表演，12fps——量化在 driver-face 內部做，這裡傳原始時間。
      visual.setExpressionTime(snap.t);

      this.#prevPos[i] = [x, y, z];
      this.#prevYaw[i] = kart.yaw;

      if (i === snap.playerIndex) {
        playerIx = ix;
        playerIy = iy;
        playerIz = iz;
        playerIyaw = iyaw;
      }
    }

    // `BAR-PERF §4.2`：載具 transform 實際被寫入的次數。**每幀算一次**，
    // 不是每台車各算一次——§4.2 判的是「載具有沒有被抽格」，不是場上有幾台車。
    if (snap.karts.length > 0) renderTelemetry.vehicleTransformUpdates += 1;

    // 光照鑽機跟著玩家走，陰影 frustum 才框得到車。燈的參數不變。
    this.#lighting.position.set(playerIx, playerIy, playerIz);

    const [fx, fz] = forwardVector(playerIyaw);
    // `BAR-PERF §4.3`：相機 transform 實際被寫入的次數。**不得抽格**。
    renderTelemetry.cameraUpdates += 1;
    this.#camera.position.set(
      playerIx - fx * CAMERA_FOLLOW_DISTANCE,
      playerIy + CAMERA_FOLLOW_HEIGHT,
      playerIz - fz * CAMERA_FOLLOW_DISTANCE,
    );
    this.#camera.lookAt(
      playerIx + fx * CAMERA_LOOK_AHEAD,
      playerIy + CAMERA_LOOK_HEIGHT,
      playerIz + fz * CAMERA_LOOK_AHEAD,
    );

    this.#drawHud(snap);
    this.#renderer.render(this.#scene, this.#camera);
  }

  #drawHud(snap: SimSnapshot): void {
    const lap = snap.laps[snap.playerIndex];
    // playerIndex 保證落在 laps 範圍內（契約不變量，見 sim.ts）；
    // 這個 guard 只是滿足 noUncheckedIndexedAccess，不是預期的執行路徑。
    if (!lap) return;
    const lines = [
      `LAP ${Math.min(lap.current, lap.total)}/${lap.total}`,
      `TIME  ${formatTime(lap.currentTime)}`,
      `BEST  ${lap.bestTime === null ? '--' : formatTime(lap.bestTime)}`,
    ];
    this.#hud.textContent = lines.join('\n');
  }

  resize(w: number, h: number): void {
    if (w === 0 || h === 0) return;
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(w, h);
  }

  dispose(): void {
    this.#renderer.dispose();
    this.#hud.remove();
  }
}

export function createRenderer(mount: HTMLElement): Renderer {
  return new ClayRenderer(mount);
}
