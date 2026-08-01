/**
 * W1 renderer：封閉賽道、追尾相機、圈數 HUD。
 *
 * 黏土材質不在本輪範圍（W3 才做，見 BAR-VISUAL.md）——顏色純粹是為了
 * 區分賽道／草地／護欄，不代表任何美術方向。
 *
 * 相機刻意偏離上游 Art Bible 的 3/4 diorama 規格，理由見 BAR-VISUAL.md §0.5：
 * 那是靜態島嶼插圖的視角，套在賽車上玩家會看不到前方賽道。
 */
import * as THREE from 'three';
import type { Renderer, SimSnapshot } from '@loader/bootstrap';
import { TRACK_GEOMETRY } from '@physics/constants';

const CAMERA_FOV_DEG = 55;
const CAMERA_FOLLOW_DISTANCE = 8;
/** atan(2.1 / 8) ≈ 14.7°，落在 BAR-VISUAL §0.5 的 12–18° 規格內。 */
const CAMERA_FOLLOW_HEIGHT = 2.1;
const CAMERA_LOOK_AHEAD = 4;

const KART_HALF_HEIGHT = 0.4;

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

class W1Renderer implements Renderer {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.1, 500);
  readonly #kart: THREE.Mesh;
  readonly #hud: HTMLDivElement;

  #prevPos: [number, number, number] | null = null;
  #prevYaw = 0;

  constructor(mount: HTMLElement) {
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mount.appendChild(this.#renderer.domElement);

    this.#scene.background = new THREE.Color(0x8a8a8a);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x606060, 2.2));

    this.#buildGround();
    this.#buildTrack();
    this.#buildBoundaryWalls();

    this.#kart = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 2.4),
      new THREE.MeshLambertMaterial({ color: 0xd98f5a }),
    );
    this.#kart.position.y = KART_HALF_HEIGHT;
    this.#scene.add(this.#kart);

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

  /** 賽道外的大面積填充，純粹讓場景不是空的，不代表草地材質。 */
  #buildGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshLambertMaterial({ color: 0x7fae54 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01; // 避免與賽道面 z-fight
    this.#scene.add(ground);
  }

  /** 賽道本體：TRACK_GEOMETRY 的半徑 ± 半寬，不是碰撞面。 */
  #buildTrack(): void {
    const inner = TRACK_GEOMETRY.radius - TRACK_GEOMETRY.halfWidth;
    const outer = TRACK_GEOMETRY.radius + TRACK_GEOMETRY.halfWidth;
    const asphalt = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 96),
      new THREE.MeshLambertMaterial({ color: 0x707070, side: THREE.DoubleSide }),
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.set(TRACK_GEOMETRY.centerX, 0, TRACK_GEOMETRY.centerZ);
    this.#scene.add(asphalt);
  }

  /**
   * 視覺上的牆，畫在賽道邊界（radius ± halfWidth），不是往內縮車體半徑
   * 後的碰撞面——否則看起來會像「還沒碰到就彈開」。
   */
  #buildBoundaryWalls(): void {
    const wallHeight = 0.5;
    const wallThickness = 0.3;
    const material = new THREE.MeshLambertMaterial({ color: 0xc0503f });

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
      this.#scene.add(wall);
    }
  }

  draw(snap: SimSnapshot, alpha: number): void {
    const [x, y, z] = snap.kart.pos;
    const prev = this.#prevPos;

    const ix = prev ? prev[0] + (x - prev[0]) * alpha : x;
    const iy = prev ? prev[1] + (y - prev[1]) * alpha : y;
    const iz = prev ? prev[2] + (z - prev[2]) * alpha : z;
    const iyaw = lerpAngle(this.#prevYaw, snap.kart.yaw, alpha);

    this.#kart.position.set(ix, iy + KART_HALF_HEIGHT, iz);
    this.#kart.rotation.y = iyaw;
    this.#prevPos = [x, y, z];
    this.#prevYaw = snap.kart.yaw;

    const [fx, fz] = forwardVector(iyaw);
    this.#camera.position.set(
      ix - fx * CAMERA_FOLLOW_DISTANCE,
      iy + CAMERA_FOLLOW_HEIGHT,
      iz - fz * CAMERA_FOLLOW_DISTANCE,
    );
    this.#camera.lookAt(ix + fx * CAMERA_LOOK_AHEAD, iy + KART_HALF_HEIGHT, iz + fz * CAMERA_LOOK_AHEAD);

    this.#drawHud(snap);
    this.#renderer.render(this.#scene, this.#camera);
  }

  #drawHud(snap: SimSnapshot): void {
    const { lap } = snap;
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
  return new W1Renderer(mount);
}
