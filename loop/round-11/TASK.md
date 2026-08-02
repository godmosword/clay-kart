# R11 — W2：`ai-opponents` 第一階段——多車架構落地 + kart-kart 碰撞

**Wave:** W2
**Element:** `ai-opponents`（`loop/budget.json` cap 300000，見 `BAR-FEEL §6`）——
**這輪只做架構與碰撞物理，不做 AI 決策邏輯**，範圍見下方「這輪不做什麼」
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R10 `input-feedback`——`8.1`/`8.3` 真量測，`8.2`/`8.4` 記入 BACKLOG，
你標記 W2 單車部分暫告一段落，等 Lead 裁決下一步。

---

## 我做了什麼（Lead，`src/contract/sim.ts`，已 commit）

`SimSnapshot` 從單車改成陣列：

```ts
export interface SimSnapshot {
  tick: number;
  t: number;
  karts: readonly KartState[];
  playerIndex: number;      // karts 的索引，指出玩家車。無 AI 對手時恆為 0
  laps: readonly LapState[]; // 與 karts 同索引對齊
}

export interface KartState {
  characterId: CharacterId;   // 新增，見 CharacterId union
  // ...其餘欄位不變（pos/vel/speed/yaw/...collisionImpulse）
}

export interface WorldOptions {
  playerCharacterId?: CharacterId;      // 預設 'xiaohong'
  aiOpponents?: readonly AiOpponentConfig[]; // 不傳/空陣列＝現行單車行為
}

export interface AiOpponentConfig {
  characterId: CharacterId;
  difficulty: number; // [0,1]，這輪用不到，先收著
}
```

完整定義與逐欄位理由在 `src/contract/sim.ts` 的 doc comment 裡，先讀那份，
這裡不重複。**`setInput()` 語意沒變**——只控制 `playerIndex` 那台車，簽章
一個字都沒改。

我也已經把 `src/render/renderer.ts` 改完（多車繪製、玩家車決定相機/HUD，
AI 對手用另一個顏色純粹方便肉眼分辨，不是美術決策）。`npm run typecheck`
跟 `npm run build` 目前只在你的 `src/physics/world.ts` 報錯，兩個都是預期
中的「還沒接上」訊號：

```
src/physics/world.ts(175,11): Property 'characterId' is missing in type ... required in type 'KartState'
src/physics/world.ts(200,57): Object literal may only specify known properties, but 'kart' does not exist in type 'SimSnapshot'
```

---

## 這輪要做什麼

### 1. `src/physics/world.ts`：單車 → 多車

現在整個 `World` class 是把一台車的可變狀態（`#x #y #z #vx #vy #vz #yaw
#yawRate #grounded #collisionImpulse #throttle #steer #brake #reverse
#driftHeld #steerCommand #jumpHeld #jumpQueued #driftState #driftCharge
#driftTier #driftTime #releaseTimer #boostSpeed #trackAngle
#hasLeftStartLine #currentLap #lapStartTick #finished #bestTime #splits`）
攤平在 class 欄位上，`step()` 依序呼叫 `#stepDriftState → #stepVertical →
#stepYaw → #stepDrive → #stepPosition → #resolveTrackCollision →
#updateLapState`。

需要把這份狀態變成「每台車一份」，`World.step()` 對每台車跑一次同樣的
step 序列，再跑一次新的 kart-kart 碰撞解算（見下）。內部要不要拆成獨立
class、怎麼命名，你決定——這是實作細節，不是契約的一部分。

`createWorld(options?: WorldOptions): PhysicsWorld` 的相容性要求（硬性）：
不傳 `options`，或 `aiOpponents` 傳空陣列，行為必須跟現在**完全一樣**——
一台車、`playerIndex` 恆為 0。這是因為十輪累積下來，`w1-physics.mjs` 跟
`ghost-replay.mjs` 的所有既有 fixture 都用零參數 `createWorld()`，一個都
不該因為這次擴充而改變輸出。

角色差異這輪**不用管**：不管 `characterId` 是誰，物理參數（引擎加速度、
極速、抓地力……）全部沿用現有全域常數，AI 對手跟玩家用同一份調校。
per-character 數值分化是 `CHARACTERS.md` 講的「W2 尾聲」工作，跟這輪
的架構工作是兩件事，不要在這輪一起做。

### 2. AI 對手的輸入：這輪不需要 `src/ai/`

`WorldOptions.aiOpponents` 指定了有幾台 AI 車跟各自的 `characterId`，
但**這輪的 AI 車不需要真正的駕駛決策**——真正的超車/橡皮筋/難度邏輯要
等 Lead 把 `BAR-FEEL` 的行為指標補齊之後才開工（見 `loop/BACKLOG.md`
「BAR-FEEL 缺 AI 對手的行為指標」條目）。這輪的 AI 車只要有個決定性的
佔位輸入即可讓它們動起來、彼此/跟玩家車有機會碰撞——例如固定油門、
不轉向，或乾脆靜止不動都可以。你決定，怎麼簡單怎麼來，重點是決定性
（不能用 `Math.random()`）。

### 3. 新物理：kart-kart 碰撞（屬 `BAR-FEEL §6`，不是新 bar）

`#resolveTrackCollision()` 現在解的是「車 vs. 賽道邊界」的圓形邊界碰撞。
需要新增「車 vs. 車」的碰撞解算——兩個動態圓形體，半徑用既有的
`KART_BOUNDING_RADIUS`（兩車距離小於兩倍這個值即算重疊）。

驗收指標已存在，不是新的：

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 6.4 | `kart_kart_impulse_symmetry` | `[0.92, 1.08]` | 雙方受力對稱性 |

具體用什麼恢復係數、動量分配公式，你決定，跟 6.1-6.3 的牆面碰撞一樣
是你調到符合窗口。**唯一硬性要求**：兩車各自的 `collisionImpulse`
在同一次碰撞事件裡要能量出對稱性比值——這代表你可能需要在事件層
（不是 frame 層，`KartState.collisionImpulse` 維持純量不變）記錄
「這次碰撞的另一方是誰、對方的衝量是多少」，格式你定，`ghost-replay.mjs`
那邊要能讀到才算數。

### 4. Telemetry 消費端：機械式更新（我已用 grep 逐一核對過範圍）

- `tools/telemetry/ghost-replay.mjs`——`frameFromSnapshot()`/`collisionData()`/
  `landingData()` 目前直接讀 `snapshot.kart`/`previous.kart`/`current.kart`，
  改成讀 `snapshot.karts[snapshot.playerIndex]`。**`frames[]` 的 schema
  本身不變**（`BAR-FEEL §1.2` 沒有動），只有取值路徑變了——這是刻意的，
  frame 是給玩家車用的，AI 對手的資料另外走 events，不要把 frame 撐大
  成每 frame 帶 N 台車。額外新增：能承載 6.4 所需的 kart-kart 碰撞事件
  資料（見上一節）。
- `tools/validate/w1-physics.mjs`——8 處 `.kart.pos/yawRate/speed/yaw/vel`
  同樣改成 `.karts[0]`（這個檔案的既有 fixture 全是零 AI 對手情境，
  索引恆為 0，不用引入 `playerIndex` 概念）。

### 5. 新增一個 deterministic probe 量測 6.4

跟 R7 的擦牆/正面撞牆 probe、R9 的落地 probe 同一個模式：專門建一個
最小、決定性的 replay 情境——兩台車在收斂路徑上必然相撞（固定初始位置
與固定輸入，不依賴一般 lap fixture 裡偶發的碰撞事件），用來獨立算出
6.4。不要從一般 gameplay fixture 的雜訊裡撈這個數字。

---

## 完成的定義

- [ ] `createWorld()` 零參數＝現行單車行為，位元級不變（既有 fixture 的
      ghost-replay 輸出跟這輪之前逐位元相同——這是最強的回歸保證）
- [ ] `createWorld({ aiOpponents: [...] })` 能跑出 N+1 台車，`karts[]`/
      `laps[]` 陣列長度正確，`playerIndex` 正確
- [ ] kart-kart 碰撞已實作，`6.4` 有真實量測且落在 `[0.92, 1.08]`
      （若調不進窗口，照慣例：如實記錄實際數字、記入 BACKLOG，不要
      硬湊或虛構）
- [ ] `ghost-replay.mjs`／`w1-physics.mjs` 的 `.kart`/`.lap` 存取路徑
      全部更新完，兩者 exit 0
- [ ] §2/§3/§4/§5（尤其 `4.5`）/§6.1-6.3/§7/§8 玩家車指標不退化——
      這些現在全部從 `karts[playerIndex]` 取值，換路徑不該換數值
- [ ] ghost-replay 三次仍 byte-identical（多車情境也要驗，不只單車）
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `pytest` 全數通過
- [ ] 新的 `loop/round-11/VERDICT.json`，schema 驗證通過
- [ ] `loop/budget.json` 的 `ai-opponents.spent` 更新為這輪實際花費
      （這是 300000 cap 裡的第一筆分期，不是全部——後面 AI 決策邏輯
      進來時還會再花，不用想著這輪要把 cap 花完或留多少）

## 這輪不做什麼

- **不做 AI 駕駛決策**（超車、路線跟隨、難度分級）——那需要 Lead 先補
  `BAR-FEEL` 的行為指標，還沒補
- **不做 per-character 物理調校**——所有車共用現有全域常數
- 不碰 `drift-miniturbo`／`steering-grip`／`airborne-landing`／
  `input-feedback` 已經調好或已誠實記錄的部分

## 實作方式由你決定

`World` 內部怎麼從單車重構成多車（拆 class、用陣列存欄位……）、kart-kart
碰撞的恢復係數怎麼調、AI 佔位輸入長什麼樣、事件格式怎麼命名——都你決定。
唯一不能動的是 `src/contract/sim.ts`（Lead-only）跟上面列的硬性相容性
要求。
