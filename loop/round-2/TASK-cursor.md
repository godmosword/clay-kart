# R2 — Cursor

**Wave:** W1 收尾
**Owner:** Cursor（`../ck-plumb`，分支 `feat/plumb`）
**可寫路徑:** `src/ui/`、`src/loader/`、`build/`、`package.json`

---

## 這份任務跟你平常的角色不同

`prompts/cursor-chores.md` 說你「只做機械性工作，需要判斷就停下來寫 BACKLOG」。
**本輪例外** —— 這是一個有設計成分的任務，而且它的設計約束會決定 W2 能不能跑。
約束我寫在下面，但實作路徑由你決定，不要停下來問。

---

## 落差 — 車子無法操控

**現況：** `src/physics/world.ts` 匯出 `setInput(input: WorldInput)`，
但全 repo 沒有任何呼叫端。`src/loader/bootstrap.ts` 的主迴圈只呼叫 `step()` 與 `snapshot()`。
車子以預設 `throttle = 1, steer = 0` 自己跑。

**目標：** `loop/PLAN.md` 的 W1 完成條件是「**可玩**骨架」。玩家要能實際駕駛。

**落差：** 目前沒有任何輸入來源。

---

## 三個硬性約束

這三條不是風格建議。違反其中任何一條，W2 的整套驗收會垮。

### 約束一：輸入必須可被錄製與重播取代

W2 的 `tools/telemetry/ghost-replay`（`CODEX.md §5`）要在 **Node 裡 headless 重播**
一份固定輸入序列，且**同輸入跑三次輸出必須 byte-identical**。

所以輸入不能是「鍵盤事件直接呼叫 `setInput`」這種寫死的形式。
必須讓「即時鍵盤／觸控」與「錄好的固定序列」是可互換的兩種來源。

**這是本輪最重要的一條。** 做錯的話 W2 開場第一件事就得回頭重做。

### 約束二：輸入取樣點在固定 tick，不在動畫幀

主迴圈是固定步長 accumulator：一個動畫幀可能跑 0 個、1 個或多個 `step()`。
若在動畫幀取樣輸入，同一份操作在不同幀率下會產生不同的模擬結果，決定性就沒了。

輸入必須在每個 `step()` 之前、以每 tick 一次的方式進入模擬。

### 約束三：不得破壞既有的固定步長契約

`src/loader/bootstrap.ts` 目前的 accumulator 與 `MAX_TICKS_PER_FRAME` 保護不要動。
`world.step()` 會鎖定它收到的第一個 `dt`，之後傳不同值會拋 `RangeError`。

---

## 兩個型別／契約問題

**1.** `bootstrap.ts:84` 目前是：

```ts
const world: SimWorld = createWorld();
```

`SimWorld` 沒有 `setInput`，那在 `PhysicsWorld` 上。這行在你的範圍內，自己處理。

**2.** `WorldInput` 的欄位是 optional，**未提供的欄位保留前值**。
這對「按住」語意是方便的，對「錄製重播」則需要想清楚每 tick 要送什麼。

---

## 操作需求

| 動作 | 對應 `WorldInput` |
|---|---|
| 加速 | `throttle` |
| 煞車 | `brake` |
| 轉向 | `steer`，範圍 `[-1, 1]` |
| 倒車 | `reverse` |
| 跳躍 | `jump`（one-shot，`setInput` 內部已做邊緣偵測） |

**鍵盤與觸控都要。** 主要目標裝置是 iPad（`BAR-PERF.md §1`），
受眾是 3–7 歲兒童，只有鍵盤等於在目標平台上不可玩。
觸控不需要好看 —— W1 不做美術，能操作就好。HUD 的黏土化是 W3 的 `ui-hud` 元件。

---

## 順帶一件小事

`package.json` 沒有 `test` script，Codex 的 `tools/validate/w1-physics.mjs` 只能手動跑。
`package.json` 在你的範圍。加上去，讓那支 harness 能用 npm 執行。
它預設會讀 `build/out/assets/world-*.js`，所以需要先 build。

---

## 完成的定義

- [ ] 鍵盤可駕駛：加速、煞車、轉向、倒車、跳躍
- [ ] 觸控可駕駛（iPad Safari）
- [ ] 輸入來源可被固定序列取代，且該路徑不需要瀏覽器
- [ ] 同一份固定輸入序列跑三次，模擬輸出 byte-identical
- [ ] 主迴圈仍是固定步長，`MAX_TICKS_PER_FRAME` 保護仍在
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `npm run dev` 起得來，車子能被玩家開完三圈
- [ ] harness 可用 npm script 執行且仍 PASS

## 不要做

不要改 `src/physics/`、`src/render/`、任何 `BAR-*.md` 或 `CHARACTERS.md`。
不要做美術、HUD 樣式、音效。不要調物理數值。
