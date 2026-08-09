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
import { ITEM_BOXES, TRACK_GEOMETRY } from '@physics/constants';

/**
 * 接地色塊擺在路面頂再往上一點點，避免與路面 z-fight。
 */
const CONTACT_SHADOW_LIFT = 0.012;
import { exposeRenderTelemetry, renderTelemetry } from '@contract/render-telemetry';
import {
  createKart,
  createKartProxy,
  type KartVisual,
} from './components/kart.js';
import { applyClayRenderSettings, createClayLighting } from './clay/lighting.js';
import { createTrackBarrierRings } from './components/track-barriers.js';
import { createTrackSurfaceRing, ROAD_SURFACE_Y } from './components/track-surface.js';
import { createFoliageScatter } from './components/foliage.js';
import { createItemBoxes, type ItemBoxField } from './components/item-boxes.js';
import { createClayMaterial } from './clay/material.js';
import { CAR_PARK, TERRAIN, XIAOHONG } from './clay/palette.js';
import { createClayAudio, type ClayAudio } from '@audio/index';

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
   * 那個），燈的參數一個都沒變，只是把整組平移過去。遊戲路徑保留靜態場景的
   * 即時 shadow-map，車輛本身則用 contact patch 補接地感；拍攝台仍走
   * `clay/lighting.ts` 的完整陰影設定。
   */
  // **遊戲端保留即時陰影。** R32 有一版為了降 draw call 把它整個關掉，
  // 只留玩家車底下一個圓形色塊——樹、護欄、對手全部沒有陰影。
  //
  // 那個取捨用量測否定了：開陰影是 `draw_calls 137`（窗口 [0,150]）、
  // `triangles_k 58.7`（[0,400]），關陰影是 126 / 55.5。**陰影只花 11 個
  // draw call**，而它換掉的是 `§5.10 shadows-contact` 這一整個元件在遊戲裡
  // 的存在，以及 `§5.0` 燈光鐵律裡的接地陰影與 AO。
  //
  // 「元件圖有、遊戲裡沒有」正是 `§5.3` 明文要排除的那種通過方式。
  readonly #lighting = createClayLighting({ shadows: true });

  /**
   * 遊戲音訊。合成，不播音檔——上游素材是 6.6 分鐘的 podcast 旁白，
   * 不是音效（`CHARACTERS.md §7` 說「可 100% 複用」是錯的，R36 實測）。
   * 沒有 Web Audio 的環境下所有方法是 no-op，不會擋住算繪。
   */
  readonly #audio: ClayAudio = createClayAudio();
  /**
   * 元件 #9 `item-boxes`。位置來自 `@physics/constants` 的 `ITEM_BOXES`
   * ——**跟拾取判定同一份資料**，視覺與物理不會各自漂移。
   */
  #itemBoxes: ItemBoxField | null = null;
  /** 上一幀每個箱子的 `available`，用來偵測拾取／重生這兩個邊緣事件。 */
  #itemBoxAvailable: boolean[] = [];

  /**
   * 每台車一塊接地色塊。**不只玩家車**——R32 有一版只給玩家，
   * 對手因此完全沒有接地感，看起來像浮在路面上。
   */
  readonly #contactShadows: THREE.Mesh[] = [];

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
    // 陰影留著，理由與成本見上面 `#lighting` 的註解。玩家車底下那塊
    // contact patch 仍然保留——它補的是即時陰影在極斜角度下會變淡的情況，
    // 是加強不是替代。
    applyClayRenderSettings(this.#renderer, { shadows: true });
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

    // `BAR-CONTENT §2.3`／`§2.4` 的量測掛鉤。跟 `exposeRenderTelemetry()`
    // 同一個理由掛在這裡：曝露點與擁有者放在一起才不會漂。
    (window as unknown as { __CLAY_AUDIO__?: unknown }).__CLAY_AUDIO__ = {
      debugState: () => this.#audio.debugState(),
      __forceSpeedRatio: (r: number) => this.#audio.forceSpeedRatio(r),
    };

    this.#buildGround();
    this.#buildTrack();
    this.#buildBoundaryWalls();
    this.#buildFoliage();
    this.#buildItemBoxes();


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
    // `§5.6` 的色條款寫著「草地三階都要用上 —— 單一綠會讓整片地變成塑膠
    // 地毯」。這塊地只有 `grassMid` 一階，**它自己不滿足那一條**。滿足它的是
    // `#buildFoliage()` 撒在上面的草叢與樹冠，另外兩階在那裡用掉。
    // 換句話說這塊地不得單獨存在——拿掉 foliage 就會違反 §5.6。
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01; // 避免與賽道面 z-fight
    ground.receiveShadow = true;
    this.#scene.add(ground);
  }

  /**
   * **元件 #6 `foliage`（R30）。** 賽道內外的樹與草叢。
   *
   * 這也是讓 `#buildGround()` 那塊單一綠的地滿足 `§5.6` 色條款的東西——
   * 草地三階裡的 `grassLight` 與 `grassDark` 都在這裡用掉。
   *
   * `createFoliageScatter` 全部走 `InstancedMesh`：六次 draw call
   * （圓穹 1 + 樹幹 1 + 葉瓣 2 + 草叢 2），與樹的數量無關。
   */
  #buildFoliage(): void {
    const foliage = createFoliageScatter(
      TRACK_GEOMETRY.radius,
      TRACK_GEOMETRY.halfWidth,
    );
    foliage.position.set(TRACK_GEOMETRY.centerX, 0, TRACK_GEOMETRY.centerZ);
    this.#scene.add(foliage);
  }

  /**
   * **元件 #9 `item-boxes`。** 位置直接讀 `ITEM_BOXES`，不自己算——
   * 那份常數同時是物理側 `#stepItemBoxes()` 的拾取判定來源，
   * 兩邊共用才不會出現「看得到但撞不到」。
   */
  #buildItemBoxes(): void {
    const field = createItemBoxes(
      ITEM_BOXES.map((box) => [box.position[0], box.position[2]] as const),
    );
    this.#itemBoxes = field;
    this.#itemBoxAvailable = ITEM_BOXES.map(() => true);
    this.#scene.add(field.group);
  }

  /**
   * 一塊接地色塊。`§5.10` 的條文字面是「陰影**短、柔、低對比**，落在物件
   * 正下方略偏前」——柔邊圓形色塊比 shadow map 的硬邊投影更接近那句話，
   * 同時只花一個 draw call。
   */
  #addContactShadow(): THREE.Mesh {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({
        color: TERRAIN.contactShadow,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    shadow.name = 'kart-contact-shadow';
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.0, 1.55, 1);
    // **必須高過路面。** 原本是 0.012，而 `track-surface` 的路面頂在
    // `SLAB_HEIGHT 0.13 + OVERLAY_LIFT 0.155 = 0.285`——色塊整個被埋在路面
    // 底下，一次都沒有顯示過。R32 的截圖裡「車子沒有影子」就是這個原因，
    // 不是陰影參數不對。
    shadow.position.y = ROAD_SURFACE_Y + CONTACT_SHADOW_LIFT;
    this.#scene.add(shadow);
    return shadow;
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
   * 視覺上的邊界，畫在賽道邊界（radius ± halfWidth），不是往內縮車體半徑
   * 後的碰撞面——否則看起來會像「還沒碰到就彈開」。
   *
   * **這裡就是元件 #5 `track-barriers`（R28）。** 在此之前是兩圈
   * `TorusGeometry` 圓管——那正是 `§5.5` 點名要排除的東西：「護欄是一段一段
   * 捏出來再接起來，**不是一根無限長的擠出管**」。現在是離散段體，段間留縫、
   * 長度取三個變體輪流、橘白交替。
   *
   * 用 `InstancedMesh`：兩圈約 280 段，每個 `Mesh` 一次 draw call 會直接撞穿
   * `BAR-PERF §5.3` 的 150 預算。合成之後是 3 個長度 × 2 個顏色 = 6 次。
   */
  #buildBoundaryWalls(): void {
    const barriers = createTrackBarrierRings(
      TRACK_GEOMETRY.radius,
      TRACK_GEOMETRY.halfWidth,
    );
    barriers.position.set(TRACK_GEOMETRY.centerX, 0, TRACK_GEOMETRY.centerZ);
    this.#scene.add(barriers);
  }

  /**
   * 索引 i 的車若不存在就先建立——渲染層不預先假設車數。
   *
   * 玩家車使用完整黏土元件；AI 車目前只有識別色，使用單 mesh proxy，
   * 避免把尚未有專屬造型的暫時車輛成本放大到每一台。這是 gameplay LOD，
   * 不影響 `components/kart.ts` 的元件拍攝路徑。
   */
  #ensureKart(i: number, isPlayer: boolean): KartVisual {
    let kart = this.#karts[i];
    if (kart) return kart;
    const bodyColor = isPlayer
      ? XIAOHONG.body
      : (AI_LIVERY[(i - 1 + AI_LIVERY.length) % AI_LIVERY.length] ?? CAR_PARK.accentBlue);
    kart = isPlayer ? createKart({ bodyColor }) : createKartProxy(bodyColor);
    // **車輛刻意不進 shadow-map pass。** 每個 castShadow 的 mesh 都會在陰影
    // pass 再畫一次，而四台車就是 121 個 mesh——實測把 `enableClayShadows()`
    // 套回車上，`draw_calls` 從 126 變 **252**，直接爆掉 `§5.3` 的 150。
    //
    // 改用接地色塊。**這不是為了省而妥協**：`§5.10` 的條文字面就是
    // 「陰影短、柔、低對比，落在物件正下方略偏前」——一塊柔邊圓形色塊比
    // shadow map 的硬邊投影更接近那句話。靜態場景（樹、護欄、路面）仍走
    // 真實陰影，它們的 mesh 數少，成本可控。
    this.#scene.add(kart.group);
    this.#contactShadows[i] = this.#addContactShadow();
    this.#karts[i] = kart;
    this.#rolled[i] = 0;
    return kart;
  }

  draw(snap: SimSnapshot, alpha: number): void {
    // `BAR-PERF §4` 的分母。有它才分得開「抽格」與「慢」：
    // updates / renderedFrames 該是 1.0，與機器快慢無關。
    renderTelemetry.renderedFrames += 1;

    // 音訊從這裡驅動而不是 bootstrap——後者是 Cursor 的範圍，
    // 而音訊要的正是「每幀最新的 snapshot」，renderer 本來就有。
    // 詳見 `src/audio/index.ts` 的檔頭。
    this.#audio.update(snap);

    let playerIx = 0, playerIy = 0, playerIz = 0, playerIyaw = 0;
    let characterAnimationInstances = 0;

    // 本幀推進的模擬時間。輪子自轉吃距離、表情吃時間，兩者都要它。
    // 道具箱：自轉與浮動吃連續時間（`§5.9` 明文 60fps 不抽格），
    // 拾取／重生從 `snap.itemBoxes[].available` 的邊緣偵測。
    if (this.#itemBoxes) {
      const boxes = this.#itemBoxes;
      for (let i = 0; i < snap.itemBoxes.length; i++) {
        const available = snap.itemBoxes[i]?.available ?? true;
        const was = this.#itemBoxAvailable[i] ?? true;
        if (was && !available) boxes.pick(i, snap.t);
        else if (!was && available) boxes.respawn(i);
        this.#itemBoxAvailable[i] = available;
      }
      boxes.setTime(snap.t);
    }

    const simDt = this.#prevSimTime === null ? 0 : Math.max(0, snap.t - this.#prevSimTime);
    this.#prevSimTime = snap.t;

    for (const [i, kart] of snap.karts.entries()) {
      const visual = this.#ensureKart(i, i === snap.playerIndex);
      if (visual.hasCharacterAnimation) characterAnimationInstances += 1;
      const [x, y, z] = kart.pos;
      const prev = this.#prevPos[i] ?? null;

      const ix = prev ? prev[0] + (x - prev[0]) * alpha : x;
      const iy = prev ? prev[1] + (y - prev[1]) * alpha : y;
      const iz = prev ? prev[2] + (z - prev[2]) * alpha : z;
      const iyaw = lerpAngle(this.#prevYaw[i] ?? kart.yaw, kart.yaw, alpha);

      // 整車原點就在車體正下方的地面（見 components/kart-body.ts），
      // 所以直接吃快照的 y，不再補半個車高。
      // **加上路面高度。** 模擬的 y 是 0（它的地面就是 y=0 的平面），而
      // `track-surface` 的路面頂在 `ROAD_SURFACE_Y`。不加的話車會有
      // 0.285 埋進路裡——約四分之一個輪徑，看起來像輪子做小了。
      // 這是 R25 把路面墊高時漏掉的，R32 查接地色塊為什麼看不到才發現。
      visual.group.position.set(ix, iy + ROAD_SURFACE_Y, iz);
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

    // R30 §4.1 需要分母是實際有角色動畫的車，而不是 HUD 的參賽車總數；
    // AI gameplay LOD 刻意沒有臉。這個值走 RenderTelemetry 正式契約，缺值時
    // 探針應誠實 FAIL，不可猜測。
    renderTelemetry.characterAnimationInstances = characterAnimationInstances;

    // `BAR-PERF §4.2`：載具 transform 實際被寫入的次數。**每幀算一次**，
    // 不是每台車各算一次——§4.2 判的是「載具有沒有被抽格」，不是場上有幾台車。
    if (snap.karts.length > 0) renderTelemetry.vehicleTransformUpdates += 1;

    // 光照鑽機跟著玩家走，陰影 frustum 才框得到車。燈的參數不變。
    this.#lighting.position.set(playerIx, playerIy, playerIz);
    // 每台車的色塊跟著自己那台走。只更新玩家那塊的話，對手的色塊會留在
    // 起跑線上——那比沒有色塊更糟。
    for (let i = 0; i < this.#karts.length; i++) {
      const patch = this.#contactShadows[i];
      const kart = this.#karts[i];
      if (!patch || !kart) continue;
      patch.position.set(kart.group.position.x, ROAD_SURFACE_Y + CONTACT_SHADOW_LIFT, kart.group.position.z);
      patch.rotation.z = -kart.group.rotation.y;
    }

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
