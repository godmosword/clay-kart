# R28（Cursor）— AI 對手從來沒有接進遊戲

**Wave:** W3
**Owner:** Cursor（`../ck-plumb`，分支 `feat/plumb`）
**可寫範圍:** `src/ui/`、`src/loader/`、`build/`
**前一輪:** `129933a` —— `ui-hud` 走 `§1.3` 機械驗收落地

---

## 一、AI 對手接進遊戲（優先，也是二的前提）

### 現況

`src/loader/bootstrap.ts:104`：

```ts
const world: SimWorld = createWorld();
```

**沒有傳 `aiOpponents`。場上只有玩家一台車。**

而物理側從 R11 到 R15 花了五輪做 AI：多車架構、kart-kart 碰撞、真正的
駕駛決策、橡皮筋追趕。`BAR-FEEL §12` 四項全數 PASS
（`12.1 ai_lap_completion=true`、`12.2 ai_overtake_time_s=3.6333`、
`12.3 difficulty_lap_time_spread_s=3.0167`、`12.4 rubberband_speed_bonus_ratio=1.0032`）。

`src/render/renderer.ts` 也早就支援多車——`AI_LIVERY` 那段依索引給對手不同
車色，`#ensureKart()` 明講「渲染層不假設固定車數」。

**兩邊都做好了，中間那一行沒接。玩家從來沒在畫面上看過對手。**

這跟 R20 發現的「黏土車做好了但遊戲跑的還是 W1 方塊車」是同一個形狀：
元件通過了驗收，但沒有裝到遊戲上。

### 要做的事

`createWorld({ aiOpponents: [...] })`。數量與難度參數請讀
`src/physics/world.ts` 的 `WorldOptions` 與 `src/ai/controller.ts` 決定——
**那兩個檔案都在 `FROZEN.md` 裡，只能讀不能改**。

### 驗收

- 實機截圖看得到對手車，且顏色與玩家不同（`AI_LIVERY`）
- `npm run test:steer-screen` 仍 PASS（多車不該影響玩家的轉向）
- `npm test`（W1）仍 PASS

### 注意

`BAR-FEEL` 的 46/46 是用 `ghost-replay` 的固定 fixture 量的，**不受這個改動
影響**——那條路徑不經過 `bootstrap.ts`。但如果你發現它受影響了，那本身就是
一個發現，請停下來寫進 `loop/BACKLOG.md`。

---

## 二、HUD 加上名次

`BAR-VISUAL §5.12` 寫的是「**圈數/計時/名次**的底板」，而
`src/ui/clay-hud.ts` 只有 `LAP` / `TIME` / `BEST`——**名次沒有做**。

在一之前這一條做不了（只有一台車，名次永遠 1/1），所以順序不能反。

名次由 `SimSnapshot` 的 `laps` 與各車位置推算。**排序邏輯放 `src/ui/`**：
它是顯示用的衍生值，不是模擬狀態，不要試圖改物理側（而且那邊凍結了）。

### 驗收

- `npm run test:ui-hud` 仍 PASS（新增一列不得讓底板短邊比超標，見三）
- 名次列的顏色沿用 `§5.12` 的數字色 `#3a5f96`

---

## 三、把 `ui-hud` 的餘裕拉開

`§1.3` 的條款是「底板短邊 / 畫面短邊 ≤ 1/8」。Lead 實測
`ratio = 0.12415`，上限 `0.125`——**餘裕只有 0.7%**。

加上名次那一列之後幾乎一定會超標。**先把底板縮小到有真正的餘裕**
（建議 ≤ 0.11，留約 12%），再加列。

這一條 Lead 已裁決「接受現況 + 把餘裕拉開」——不是要求重做美術，
只是不要讓一個 0.7% 餘裕的檢查在下一次改動時靜靜翻紅。

---

## 完成的定義

- [ ] `createWorld({ aiOpponents: [...] })`，實機截圖看得到不同顏色的對手車
- [ ] HUD 顯示名次，色用 `#3a5f96`
- [ ] `npm run test:ui-hud` PASS 且 `ratio ≤ 0.11`
- [ ] `npm run test:steer-screen` PASS、`npm test`（W1）PASS、`typecheck` exit 0
- [ ] **不得修改** `src/physics/`、`src/ai/`、`src/render/`、`src/contract/`
      ——前三個不是你的範圍，`src/contract/` 是 Lead 專屬

## 收尾

依 `loop/README.md` 的三道檢查。**這個 session 已經有五次「工作做完但沒
commit」**——`git status --short` 那道檢查每次都要靠時機才抓得到。
做完就 commit，不要等 Lead 來問。
