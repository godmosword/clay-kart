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

**現況（已更新，2026-08-01）：** 一份獨立的架構審查發現 `SimWorld` 契約沒有
`setInput` 的合法路徑，`bootstrap.ts` 的 `const world: SimWorld` 型別窄化後
連呼叫都無法 typecheck。Lead 已經修好這個契約洞，**不需要你處理**：

- `src/contract/sim.ts`（新檔案，Lead 專屬）現在的 `SimWorld` 介面正式包含
  `setInput(input: WorldInput): void`
- `bootstrap()` 現在簽名是 `bootstrap(mount, inputSource?: InputSource)`，
  `InputSource` 只有一個方法：`poll(tickIndex: number): WorldInput`
- 主迴圈已經在每個 `step()` 之前呼叫 `inputSource.poll()` 並餵給 `setInput()`，
  用的是共用的 `advance(world, ticks, poll)`（也在 `src/contract/sim.ts`）
- 沒有傳 `inputSource` 時預設 no-op（`poll: () => ({})`），行為與現在完全一樣
  （車子維持 `throttle=1, steer=0` 直行），不會改變任何既有驗證結果

**你要做的縮小成：** 實作一個真正讀鍵盤／觸控的 `InputSource`，
在 `src/main.ts` 建立它並傳給 `bootstrap(mount, yourInputSource)`。

**目標：** `loop/PLAN.md` 的 W1 完成條件是「**可玩**骨架」。玩家要能實際駕駛。

---

## 兩個約束（已被契約保證，你只需要遵守介面）

### 約束一：不要繞過 InputSource 直接呼叫 setInput

`poll(tickIndex)` 每個 tick 恰好被呼叫一次、在 `step()` 之前——這是 `advance()`
保證的，不是你要自己確保的事。你只要把「讀鍵盤/觸控的當下狀態」寫進 `poll()`
回傳的 `WorldInput` 裡，取樣時機已經對了。

**不要**在鍵盤事件監聽器裡直接呼叫 `world.setInput()`——那樣會在動畫幀而非
tick 邊界取樣，決定性就沒了。`poll()` 應該只讀一個你自己維護的「目前按鍵狀態」
物件，不做任何有副作用的事。

### 約束二：可被固定序列取代

`InputSource` 只是一個介面。你的鍵盤/觸控實作是一種 `InputSource`；
W2 的 ghost-replay 會用讀 fixture JSON 的另一種 `InputSource`（那是 Codex 的事，
不需要你先做什麼特別的事來「支援」它——介面天生就支援，只要你別讓鍵盤讀取邏輯
跟 `poll()` 的回傳值耦合成「只能從真實 DOM 事件觸發」）。

---

## 一個型別問題你仍要處理

`WorldInput` 的欄位是 optional，**未提供的欄位保留前值**。
這對「按住」語意是方便的（`poll()` 回傳 `{}` 就是「維持前一個 tick 的輸入」），
但代表你維護按鍵狀態時，放開某鍵要明確送 `steer: 0` 或 `throttle: 0`，
不能只是「不再送這個欄位」——那不會歸零，會維持上一次的值。

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
- [ ] 你的 `InputSource` 實作只讀狀態、不繞過 `poll()` 直接呼叫 `setInput`
- [ ] 放開按鍵會正確歸零（不是停止傳送該欄位）
- [ ] 主迴圈仍是固定步長，`MAX_TICKS_PER_FRAME` 保護仍在（你不需要動 `bootstrap.ts` 的迴圈本體）
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `npm run dev` 起得來，車子能被玩家開完三圈
- [ ] harness 可用 npm script 執行且仍 PASS（`node tools/validate/w1-physics.mjs` 目前已 PASS，
      確認你的改動沒有破壞它——它直接呼叫 `world.setInput()`，不經過 `InputSource`）

## 不要做

不要改 `src/physics/`、`src/render/`、任何 `BAR-*.md` 或 `CHARACTERS.md`。
不要做美術、HUD 樣式、音效。不要調物理數值。
