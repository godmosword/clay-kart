/**
 * 模擬契約。**僅 Lead 可寫，一旦穩定即列進 FROZEN.md。**
 *
 * 這份檔案定義 Codex（src/physics/）與 Claude Code（src/render/）
 * 兩邊都要實作的介面。它原本內嵌在 src/loader/bootstrap.ts——但那個目錄
 * 屬 Cursor 的寫入範圍（ARCHITECTURE.md 約束三），設計契約不該放在
 * 被要求「不做設計決策」的工具的可寫目錄裡。src/loader/bootstrap.ts
 * 現在只保留執行迴圈，從這裡 re-export 型別以維持既有 import 路徑不變。
 *
 * 固定 tick + accumulator 是 BAR-FEEL §2 的決定性要求所在，
 * 渲染的 interpolation 不得回饋進模擬。
 */

/** BAR-FEEL §1.1 常數。改這裡等於改驗收標準 —— 只有 Lead 可以動。 */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;

/**
 * 單一 tick 的輸入。所有欄位 optional——未提供的欄位保留前值，
 * 對應「按住」語意（例：steer 不動、throttle 持續加速）。
 */
export interface WorldInput {
  /** 標準化油門輸入。 */
  throttle?: number;
  /** 轉向輸入：-1 到 1。 */
  steer?: number;
  /** 按住時強力減速。 */
  brake?: boolean;
  /** 按住油門時反向行駛。 */
  reverse?: boolean;
  /** One-shot 跳躍請求。 */
  jump?: boolean;
}

/** Codex 實作。純資料，不得 import three、不得碰 DOM。 */
export interface SimWorld {
  /**
   * 套用本 tick 的輸入。呼叫端必須在每個 step() 之前恰好呼叫一次——
   * 取樣點在 tick 邊界，不在動畫幀，否則同一份操作在不同幀率下會
   * 產生不同的模擬結果，決定性就沒了（ARCHITECTURE.md 約束一）。
   */
  setInput(input: WorldInput): void;
  /** 推進固定一個 tick。dt 恆為 TICK_DT，不接受可變步長。 */
  step(dt: number): void;
  /**
   * 給渲染讀的唯讀快照。每次呼叫回傳新物件——呼叫端不得假設物件
   * 可變或被重用（不做 pooling）。渲染層每幀 new 物件會被
   * BAR-PERF §2.5 的 GC 檢查抓到，但那是渲染層自己的責任，
   * 不影響這裡的回傳語意。
   */
  snapshot(): SimSnapshot;
}

/**
 * 唯讀快照。欄位刻意對齊 BAR-FEEL §1.2 的 telemetry frame schema ——
 * ghost-replay 直接序列化這個結構，兩邊不要各定義一份。
 */
export interface SimSnapshot {
  tick: number;
  /** 秒，= tick / TICK_HZ */
  t: number;
  kart: KartState;
  lap: LapState;
}

export interface KartState {
  pos: [number, number, number];
  vel: [number, number, number];
  /** norm(vel)，冗餘但方便驗證器 */
  speed: number;
  /** 弧度，[-π, π] */
  yaw: number;
  yawRate: number;
  steerInput: number;
  throttleInput: number;
  driftState: 'none' | 'charging' | 'released';
  /** [0, 1]，達 1 後不再累積 */
  driftCharge: number;
  driftTier: 0 | 1 | 2 | 3;
  grounded: boolean;
  surface: 'asphalt' | 'dirt' | 'grass' | 'boost';
  /** 該 tick 的碰撞衝量，無碰撞為 0 */
  collisionImpulse: number;
}

export interface LapState {
  current: number;
  total: number;
  /** 本圈已用秒數 */
  currentTime: number;
  /** 最佳圈速，尚未完成任何一圈為 null */
  bestTime: number | null;
  /** 已完成圈數的時間，依序 */
  splits: readonly number[];
}

/** Claude Code 實作。 */
export interface Renderer {
  /** alpha 為 tick 之間的插值係數 [0,1)，僅供視覺平滑，不得寫回模擬。 */
  draw(snap: SimSnapshot, alpha: number): void;
  resize(w: number, h: number): void;
  dispose(): void;
}

/**
 * 驅動 world 前進 n 個 tick，每個 tick 呼叫一次 poll() 取得輸入。
 *
 * 瀏覽器的 rAF accumulator 迴圈與 tools/telemetry/ghost-replay 都必須
 * 呼叫這支函式，不要各自重寫 tick 驅動邏輯——兩份獨立實作遲早會漂移，
 * 症狀是「手感一直在窗口邊緣震盪」（LOOP-OPS.md §8 已列的常見失敗模式），
 * 而且很難追查，因為看起來像數值問題，實際是驅動邏輯不一致。
 */
export function advance(
  world: SimWorld,
  ticks: number,
  poll: (tickIndex: number) => WorldInput,
): void {
  for (let i = 0; i < ticks; i++) {
    world.setInput(poll(i));
    world.step(TICK_DT);
  }
}
