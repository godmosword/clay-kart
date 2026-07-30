/**
 * ⚠️ W1 骨架 stub —— 由 Codex 在 feat/physics 上以真正的實作取代。
 *
 * 這支檔案存在的唯一理由是讓 W1 骨架能編譯與執行。
 * 它示範了介面與約束，但不是物理引擎：只有等速前進，沒有加速、轉向、碰撞、圈數。
 *
 * 硬性約束（見 ARCHITECTURE.md、CODEX.md §2）：
 *   本檔案與整個 src/physics/ 不得 import three、不得碰 DOM、
 *   不得讀 wall-clock、不得用未固定種子的亂數。
 *   違反則 tools/telemetry/ghost-replay 無法 headless 決定性重播，
 *   BAR-FEEL §2 直接垮掉。
 */
import type { KartState, LapState, SimSnapshot, SimWorld } from '@loader/bootstrap';
import { TICK_HZ } from '@loader/bootstrap';

const TOTAL_LAPS = 3;

class StubWorld implements SimWorld {
  #tick = 0;
  #z = 0;

  step(dt: number): void {
    this.#tick++;
    // 佔位行為：沿 +Z 等速前進。真正的實作見 BAR-FEEL §3–§8。
    this.#z += 6 * dt;
  }

  snapshot(): SimSnapshot {
    const kart: KartState = {
      pos: [0, 0, this.#z],
      vel: [0, 0, 6],
      speed: 6,
      yaw: 0,
      yawRate: 0,
      steerInput: 0,
      throttleInput: 1,
      driftState: 'none',
      driftCharge: 0,
      driftTier: 0,
      grounded: true,
      surface: 'asphalt',
      collisionImpulse: 0,
    };
    const lap: LapState = {
      current: 1,
      total: TOTAL_LAPS,
      currentTime: this.#tick / TICK_HZ,
      bestTime: null,
      splits: [],
    };
    return { tick: this.#tick, t: this.#tick / TICK_HZ, kart, lap };
  }
}

export function createWorld(): SimWorld {
  return new StubWorld();
}
