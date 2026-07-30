/**
 * ⚠️ W1 骨架 stub —— 由 Claude Code 在 feat/visual 上以真正的實作取代。
 *
 * W1 的目標只有「畫面上看得到車在動」。
 * 這裡是一台方塊車加一塊地，中性灰背景，無任何材質工作。
 * 黏土材質是 W3 的事，見 BAR-VISUAL.md —— 現在做等於白做。
 */
import * as THREE from 'three';
import type { Renderer, SimSnapshot } from '@loader/bootstrap';

class StubRenderer implements Renderer {
  readonly #renderer: THREE.WebGLRenderer;
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  readonly #kart: THREE.Mesh;
  #prev: [number, number, number] | null = null;

  constructor(mount: HTMLElement) {
    this.#renderer = new THREE.WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    mount.appendChild(this.#renderer.domElement);

    this.#scene.background = new THREE.Color(0x8a8a8a);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x606060, 2.2));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.MeshLambertMaterial({ color: 0x707070 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.#scene.add(ground);

    // BAR-FEEL §1.1: CAR_LENGTH = 2.4
    this.#kart = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.8, 2.4),
      new THREE.MeshLambertMaterial({ color: 0xd98f5a }),
    );
    this.#kart.position.y = 0.4;
    this.#scene.add(this.#kart);
  }

  draw(snap: SimSnapshot, alpha: number): void {
    const [x, y, z] = snap.kart.pos;
    void snap.lap; // W1 stub 尚未畫 HUD；圈數由 src/ui/ 負責
    // alpha 只做視覺插值，絕不寫回模擬（ARCHITECTURE.md 約束二）
    const p = this.#prev;
    this.#kart.position.set(
      p ? p[0] + (x - p[0]) * alpha : x,
      (p ? p[1] + (y - p[1]) * alpha : y) + 0.4,
      p ? p[2] + (z - p[2]) * alpha : z,
    );
    this.#kart.rotation.y = snap.kart.yaw;
    this.#prev = [x, y, z];

    this.#camera.position.set(x, y + 5, z - 9);
    this.#camera.lookAt(x, y + 1, z);
    this.#renderer.render(this.#scene, this.#camera);
  }

  resize(w: number, h: number): void {
    if (w === 0 || h === 0) return;
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(w, h);
  }

  dispose(): void {
    this.#renderer.dispose();
  }
}

export function createRenderer(mount: HTMLElement): Renderer {
  return new StubRenderer(mount);
}
