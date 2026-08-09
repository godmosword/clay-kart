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
  /**
   * 轉向輸入：-1 到 1。
   *
   * **規範定義（模擬側）：`steer > 0` 使 `yaw` 增加。**
   * 專案慣例 `forward = (sin yaw, cos yaw)`，所以 yaw 增加＝車頭從 `+Z`
   * 轉向 `+X`。這是唯一的規範定義，`src/physics/` 與 `src/ai/` 都以它為準。
   *
   * **畫面上的後果（衍生資訊，不是定義）：** 追尾相機沿 `+forward` 看出去
   * 時，three.js 右手座標系下的 `+X` 落在**畫面左側**（相機 local X =
   * `(-fz, 0, fx)`，yaw=0 時等於 `(-1,0,0)`）。所以 `steer > 0` 在畫面上
   * 是**往左**轉。這一點違反直覺，但它是座標系與相機朝向的必然結果，
   * 不是誰寫錯了。
   *
   * **因此「哪個按鍵是右轉」屬於 `src/ui/` 的職責，不屬於這裡。**
   * 輸入層本來就是把玩家意圖翻譯成模擬輸入的那一層。
   *
   * ## 為什麼定義釘在 yaw 而不是畫面
   *
   * R20 第一版把定義寫成「`steer > 0` = 畫面往右」，那樣讀起來比較直覺，
   * 但代價是 `src/physics/world.ts` 與 `src/ai/controller.ts` 同時變成違規：
   * `controller.ts` 的 `steer = clamp(yawError / STEER_ERROR_RANGE)` 本來就
   * 把 steer 當成「要把 yaw 改多少」，翻符號會讓每台 AI 車往目標的反方向轉，
   * `BAR-FEEL §12.1`–`§12.4`（R15 全數 PASS）整組垮掉。
   *
   * 為了一個比較順口的符號約定去動已經通過驗收的模擬，是把成本放錯地方。
   * 模擬側維持不變，翻譯留在輸入層——那本來就是輸入層存在的理由。
   *
   * R20 發現的「按 → 車往左轉」是**輸入層的對應寫反了**，已修正。
   */
  steer?: number;
  /** 按住時強力減速。 */
  brake?: boolean;
  /** 按住油門時反向行駛。 */
  reverse?: boolean;
  /** One-shot 跳躍請求。 */
  jump?: boolean;
  /**
   * 按住以進入/維持漂移，放開以釋放 mini-turbo。BAR-FEEL §4 的機制細節見
   * 該節新增的「輸入機制」小節——bar 只定義了結果指標，觸發方式原本沒寫，
   * 這是 R4 之前補上的契約缺口。
   */
  drift?: boolean;
  /** 一次性的道具使用請求；呼叫端應在按鍵邊緣送出一次。 */
  useItem?: boolean;
}

/** 道具的公開種類。分配與效果都必須保持 deterministic。 */
export type ItemKind = 'boost' | 'shockwave';

/** 場上道具箱的唯讀狀態，位置定義在 `@physics/constants`。 */
export interface ItemBoxState {
  id: string;
  position: [number, number, number];
  available: boolean;
  respawnTicksRemaining: number;
}

export type SimEvent =
  | {
      type: 'item_pickup';
      tick: number;
      kartIndex: number;
      item: ItemKind;
      boxId: string;
    }
  | {
      type: 'item_use';
      tick: number;
      kartIndex: number;
      item: ItemKind;
      effect: ItemKind;
      targetKartIndices: readonly number[];
    };

/**
 * 六位既有卡司的穩定識別碼（`CHARACTERS.md §2`）。用英文 slug 不用中文，
 * 避免跨工具 JSON telemetry 的編碼邊界問題。新增角色時在這裡擴充，
 * 不要動既有值——telemetry 歷史紀錄裡可能已經序列化過舊的值。
 */
export type CharacterId =
  | 'xiaohong'   // 小紅賽車 —— 玩家預設，均衡
  | 'duoduo'     // 恐龍車多多 —— 重量級，高極速低加速
  | 'aku'        // 阿酷鑽地車 —— 履帶，高抓地低極速
  | 'dudu'       // 嘟嘟小紅車 —— 輕量，高加速低極速
  | 'anan'       // 安安救護車 —— 均衡偏穩
  | 'lingling';  // 鈴鈴清潔車 —— 均衡偏靈活

/** Codex 實作。純資料，不得 import three、不得碰 DOM。 */
export interface SimWorld {
  /**
   * 套用本 tick 的輸入。呼叫端必須在每個 step() 之前恰好呼叫一次——
   * 取樣點在 tick 邊界，不在動畫幀，否則同一份操作在不同幀率下會
   * 產生不同的模擬結果，決定性就沒了（ARCHITECTURE.md 約束一）。
   *
   * 多車架構下語意不變：只控制 `snapshot().playerIndex` 那台車。
   * AI 對手的輸入完全在 `step()` 內部決定，不透過這個方法——外部
   * 呼叫端（bootstrap.ts、ghost-replay、w1-physics.mjs）不需要知道
   * 場上有幾台車，這是刻意維持向後相容的設計，見本檔案下方的
   * `WorldOptions` 說明。
   */
  setInput(input: WorldInput): void;
  /**
   * 推進固定一個 tick。dt 恆為 TICK_DT，不接受可變步長。
   *
   * 多車架構下，AI 對手的每 tick 決策必須是純函式、決定性的——不得使用
   * `Math.random()`。若 AI 需要變化性，只能用從 fixture 的 `seed`
   * 衍生出的可重現亂數來源。違反的話 ghost-replay 的三次重播
   * byte-identical 保證就沒了，`BAR-FEEL §2` 全垮（見 §9 優先序第一條）。
   */
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
 * `createWorld()` 的選項。**不是這個檔案定義 `createWorld` 本身**——
 * 那是 `src/physics/world.ts` 的匯出函式，這裡只定義它該接受的形狀，
 * 讓 telemetry／render／loader 三邊在型別上有共同依據。
 *
 * 不傳或傳 `undefined` 時，行為必須跟這個欄位新增之前完全一樣：
 * 一台車、沒有 AI 對手。這是刻意的相容性保證——`w1-physics.mjs`、
 * `ghost-replay.mjs` 現有的十輪 telemetry 探針全部用 `createWorld()`
 * 零參數呼叫，一個都不必為了這次擴充而修改呼叫方式。
 */
export interface WorldOptions {
  /** 玩家使用的角色。預設 `'xiaohong'`（`CHARACTERS.md §2` 的 W1 預設）。 */
  playerCharacterId?: CharacterId;
  /**
   * 不提供或空陣列＝沒有 AI 對手，等同目前的單車行為。
   * 建議第一版實作先支援到 3 位（共 4 台車）——賽道寬度足夠容納更多，
   * 但先把碰撞／AI 邏輯在較小的數量上跑穩，之後要擴大不需要改架構。
   */
  aiOpponents?: readonly AiOpponentConfig[];
  /** Fixture-derived seed used for deterministic item-box allocation. */
  seed?: number | string;
}

export interface AiOpponentConfig {
  characterId: CharacterId;
  /**
   * `[0, 1]`，0 最簡單、1 最難。具體怎麼轉換成賽道表現（追蹤線精準度、
   * 橡皮筋強度）由 `src/ai/` 決定，這裡只定義外部可設定的旋鈕——
   * 行為指標本身待 Lead 另外補進 `BAR-FEEL`（見 `loop/BACKLOG.md`）。
   */
  difficulty: number;
}

/**
 * 唯讀快照。`karts`／`laps` 用相同索引對齊（`karts[i]` 對應 `laps[i]`），
 * `playerIndex` 指出哪一個索引是玩家車。
 *
 * `karts[playerIndex]` 的欄位刻意對齊 BAR-FEEL §1.2 的 telemetry frame
 * schema——ghost-replay 序列化 `frames[]` 時只取玩家車那一份，frame
 * schema 本身沒有因為多車而改變，AI 對手需要的資料另外走 events／probe
 * meta（同 R7 的碰撞 probe、R9 的落地 probe 那個模式），不要把 schema
 * 撐大成每 frame 帶 N 台車的資料。
 */
export interface SimSnapshot {
  tick: number;
  /** 秒，= tick / TICK_HZ */
  t: number;
  karts: readonly KartState[];
  /** `karts` 的索引，指出哪一台是玩家車。預設情境（無 AI 對手）恆為 0。 */
  playerIndex: number;
  laps: readonly LapState[];
  /** 本 tick 發生的離散模擬事件；沒有事件時為空陣列。 */
  events: readonly SimEvent[];
  /** 道具箱位置與冷卻狀態；索引與常數定義穩定對齊。 */
  itemBoxes: readonly ItemBoxState[];
}

export interface KartState {
  /** 這台車用哪個角色的造型／識別，不代表這個角色已有專屬調校數值。 */
  characterId: CharacterId;
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
  /**
   * 該 tick 的碰撞衝量，無碰撞為 0。牆面與車對車碰撞共用這個純量——
   * 兩者的細節（法線、對方是誰）走 events，不是這裡，跟牆面碰撞現有的
   * 做法一致（見 `tools/telemetry/ghost-replay.mjs` 的 `collisionData()`）。
   */
  collisionImpulse: number;
  /** 尚未使用的道具；每台車最多持有一個。 */
  heldItem: ItemKind | null;
  /** 目前持續中的道具效果，供渲染與 probe 讀取。 */
  itemEffect: 'none' | 'boost' | 'slow';
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
