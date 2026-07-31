# BACKLOG — 撞預算上限而未解決的落差

> 兩種東西寫進這裡：
> 1. 元件撞到 `budget.json` 的 cap 但未達 bar，剩餘落差
> 2. Cursor 遇到需要判斷的任務（LOOP-OPS §4.4），停下來寫在這裡
>
> Lead 定期裁決。Agent 不得自行從此清單取項目來做。

---

## 格式

```markdown
### {element} — {簡述}
- **輪次**：R{N}
- **現況**：{指標} = {實際值}
- **目標**：{窗口}
- **已嘗試**：{方向一}、{方向二}
- **來源**：{工具}
- **狀態**：待裁決 | 已排入 R{N} | 放棄
```

---

## 待裁決

### W2 觀察：SimSnapshot 目前只支援單車
- **輪次**：R2 架構審查發現
- **現況**：`SimSnapshot.kart` 是單數欄位，不是陣列
- **目標**：`BAR-FEEL §7`／`loop/PLAN.md` W2 第 8 元件 `ai-opponents` 需要多車
- **落差**：AI 對手需要跑同一份物理，`kart: KartState` 撐不住
- **為什麼不現在改**：`ai-opponents` 排在 W2 優先序最後，中間七個元件
  （sim-determinism 到 input-feedback）都是在單車 shape 上調物理數值。
  把 `kart` 包成 `karts: readonly KartState[]` 是純結構包裝，不牽動物理邏輯，
  現在做跟等到 `ai-opponents` 開工前做，成本一樣——沒有隨時間複利的代價
- **狀態**：已排入，觸發點＝`ai-opponents` 元件開工前

### 外部架構審查的三項欄位建議 —— 已核實，兩項採納一項駁回
- **輪次**：R2 架構審查
- **收到的建議**：`SimSnapshot` 該有 `topSpeedRatio`、`boostActive`、`boostSource`；
  `surface`／`state` 的 enum 值域跟 `BAR-FEEL §1.2` 不一致（含 `spinout`）
- **核實過程**：對整份 `BAR-FEEL.md` 執行 `grep -in spin`，零筆命中；
  比對 §1.2 的 `surface` 值域（`asphalt|dirt|grass|boost`）與 `KartState.surface`，
  **逐字相同**；§1.2 沒有任何 `state`（非 `drift_state`）欄位
- **結論**：`surface`／`state`／`spinout` 的不一致**不存在於這個 repo**，
  審查描述的內容對應不到任何實際檔案，判定為 fabricated，未採納，
  `BAR-FEEL.md` 未改動
- **`topSpeedRatio`**：未採納。`speed / BASE_TOP_SPEED` 在 validator 端就能算，
  不必存進 telemetry，加了是多一份要保持同步的冗餘資料
- **`boostActive`/`boostSource`**：未採納。對應道具箱加速，屬 W4 範圍，
  `BAR-FEEL` 目前沒有任何相關窗口定義，現在加等於臆測未規格化的東西
- **狀態**：已裁決，不採納，記錄於此避免同樣的建議被重新提出時要重查一次

### W2 觀察：穩態轉彎完全不損速
- **輪次**：R1 審查發現
- **現況**：直線與全鎖轉向的穩態速度都是 24.00，保留率 `1.0000`。
  急轉瞬間會掉到 `0.7166` 但完全回復。來源是 R1 新增的 `targetGroundSpeed` 重標定
- **目標**：`BAR-FEEL §4.10 drift_speed_retention` 窗口 `[0.88, 0.97]`
- **落差**：穩態保留率會卡在窗口外。極速上限未被突破，不是漏洞，是模型選擇
- **狀態**：W2 的 `drift-miniturbo` 元件處理，本輪不動

### W2 觀察：§5.3 目前為 0s
- **輪次**：R1 審查發現
- **現況**：放開轉向後 `yaw_rate` 一個 tick 內歸零，yaw 模型無慣性
- **目標**：`BAR-FEEL §5.3` 窗口 `[0.15, 0.35]`
- **落差**：低於窗口。**但 R1 的任務是讓它「可量測」而非「在窗口內」，任務已達成**
- **狀態**：W2 的 `steering-grip` 元件處理

### BAR-VISUAL §5.1–§5.12 個別元件條款未寫
- **輪次**：R0
- **現況**：§5.0 全元件共通條款已從 Art Bible v5 填妥，個別元件條款空白
- **目標**：12 元件各有材質細節、色彩、比例條款與一句「一眼判斷」檢查句
- **影響**：**不擋 W3 啟動。** LOOP-OPS §5 規定先把 12 元件做到「堪用」再 loop，
  §5.0 足以支撐堪用階段。個別條款在進入 loop 前補，屆時有實際產出可對照，會寫得更準
- **狀態**：已排入 W3 loop 前

### BAR-FEEL 缺 AI 對手的行為指標
- **輪次**：R0
- **現況**：`ai-opponents` 已排入 W2 第 8 順位，但只有碰撞（§6）有指標
- **目標**：超車決策、橡皮筋強度、難度分級的可量測窗口
- **影響**：不擋前七個元件。進入 `ai-opponents` 前必須補
- **狀態**：待裁決

### 文件標點全半形不一致
- **輪次**：R0
- **現況**：`BAR-FEEL.md` / `LOOP-OPS.md` 用全形（，：（）），
  `CHARACTERS.md` / `BAR-PERF.md` / `BAR-VISUAL.md` 用半形
- **影響**：純觀感。三個工具都讀得懂，不影響任何驗收
- **狀態**：待裁決（建議留給每波結束的 smoothing pass 一併處理）

---

## 已裁決

### ~~契約缺輸入路徑、歸屬混在 Cursor 目錄、tick 迴圈可能被重寫兩次~~ — 已修
- **輪次**：R2 架構審查
- **核實**：`bootstrap.ts:84` 的 `const world: SimWorld = createWorld()` 把型別窄化，
  `SimWorld` 沒宣告 `setInput`，Cursor 就算想接線也過不了 typecheck——比審查原本說的
  「完全沒有路徑」更精確：Codex 在 R1 已經做出 `setInput()` 且驗證過決定性，
  缺的是契約沒把它收進來
- **處置**：
  1. 新增 `src/contract/sim.ts`（Lead 專屬），`SimWorld` 正式納入 `setInput`
  2. `bootstrap.ts` 瘦身為純執行迴圈，型別從 `@contract/sim` re-export，
     `src/physics/world.ts`／`src/render/renderer.ts` 零改動（結構化型別，驗證過 build 通過）
  3. 新增共用 `advance(world, ticks, poll)`，瀏覽器迴圈與未來的 ghost-replay
     共用同一份 tick 驅動邏輯，避免兩份實作漂移（症狀是手感在窗口邊緣震盪）
  4. `bootstrap()` 新增 `InputSource` 參數，預設 no-op，Cursor 只需實作
     `poll(tick): WorldInput` 並在 `main.ts` 傳入——`TASK-cursor.md` 已同步更新，
     原本的「兩個型別／契約問題」章節已解決，三條硬性約束簡化為兩條
  5. `ARCHITECTURE.md`「目前缺口」章節是過期內容（寫著 `@physics/world`／
     `@render/renderer` 待實作，但兩者 R1/R2 已完成），已更新為現況並修正約束二/三
  6. `LOOP-OPS.md` §2 補一筆實作偏離，說明 `src/contract/` 為何不屬於
     手冊原本三方寫入範圍表的任何一格
- **拒絕的部分**：審查建議把 `step(dt)` 改成 `step(dt, input)`，
  會強迫 Codex 重寫並重新驗證 R1 已通過的 `setInput()` 設計，
  换來的架構純度提升不值得那個成本——兩種呼叫慣例在「輸入於 tick 邊界進入」
  這件事上是等價的，維持既有可行、已驗證的設計
- **驗證**：main 上 `typecheck`／`build` exit 0，`tools/validate/w1-physics.mjs` 仍 PASS

### ~~輸入來源沒有接線，車不可操控~~ — 已指派
- **原記錄（R1）**：`setInput()` 無呼叫端，Lead 拆 W1 時沒指派歸屬
- **裁決**：歸 **Cursor**（`src/ui/` + `src/loader/` 都在其範圍）。
  已開 `loop/round-2/TASK-cursor.md`，含三條硬性約束
  （可被固定序列取代、取樣點在 tick 不在動畫幀、不破壞固定步長契約）
- **教訓**：拆 W1 時只想到「三個工具各做一塊」，沒檢查三塊拼起來是否構成
  「可玩」。下次定義完成條件時，先問「玩家實際做得到什麼」

### ~~BAR-VISUAL §5 未完成，W3 被封鎖~~ — **判斷錯誤，已撤回**
- **原判斷（R0 bootstrap）**：缺 Art Bible，W3 無法啟動
- **實際**：`podcast-website/docs/UNIVERSE-ART-BIBLE.md` 已是 v5，
  含黃金樣本（`car-park.png`，標為最高權威）、黏土材質、燈光、配色全部齊備。
  `GAMEKIT-ART-BIBLE.md` 另有調色盤與技術錨點，但那是**像素風產品線，不適用**
- **處置**：已複製定義層進 `refs/clay/`（14 張）與 `BAR-VISUAL §5.0`。W3 未被封鎖
- **教訓**：bootstrap 時假設素材不存在而沒有實際去看上游 repo。
  下次寫「被 X 封鎖」之前先確認 X 是否真的不存在

### ~~git 全域身分為佔位值~~ — 已處置
- 已設 repo-local 身分為 `godmosword.eth / godmosword@gmail.com`
- 若非期望值請自行改，不影響任何驗收
