/**
 * ⚠️ W1 骨架 stub —— 由 Codex 在 feat/physics 上以真正的實作取代。
 *
 * 這支檔案存在的唯一理由是讓 W1 骨架能編譯與執行。
 * 它示範了約束，但不是物理引擎：只有等速前進，沒有加速、轉向、碰撞。
 *
 * 硬性約束（見 ARCHITECTURE.md）：
 *   本檔案與整個 src/physics/ 不得 import three、不得碰 DOM、
 *   不得讀 wall-clock、不得用未固定種子的亂數。
 *   違反則 tools/telemetry/ghost-replay 無法 headless 決定性重播，
 *   BAR-FEEL §2 直接垮掉。
 */
import type { SimSnapshot, SimWorld } from '@loader/bootstrap';

class StubWorld implements SimWorld {
  #tick = 0;
  #x = 0;
  #z = 0;
  #yaw = 0;

  step(dt: number): void {
    this.#tick++;
    // 佔位行為：沿 +Z 等速前進。真正的實作見 BAR-FEEL §3–§8。
    const speed = 6;
    this.#z += speed * dt;
    this.#yaw = 0;
  }

  snapshot(): SimSnapshot {
    return { tick: this.#tick, kart: { pos: [this.#x, 0, this.#z], yaw: this.#yaw } };
  }
}

export function createWorld(): SimWorld {
  return new StubWorld();
}
