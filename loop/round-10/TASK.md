# R10 — W2 手感：input-feedback

**Wave:** W2
**Element:** `input-feedback`（`loop/budget.json` cap 100000，見 `BAR-FEEL §8`）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R9 `2eefb0c`——`airborne-landing` telemetry 完成，我獨立驗證屬實，
兩個 FAIL 根因都查清楚了（見 `loop/BACKLOG.md`）。

---

## 現況——同一個模式，但這次有兩項可能是真的缺功能，不只缺量測

```
8.1  input_to_sim_latency_ticks  0.0  窗口 [0, 1]      PASS（假的，見下）
8.2  input_buffer_window_ms      0.0  窗口 [80, 130]   FAIL
8.3  throttle_deadzone           0.0  窗口 [0.0, 0.08] PASS（假的，見下）
8.4  steer_deadzone              0.0  窗口 [0.05, 0.15] FAIL
```

我查過：`ghost-replay.mjs` 從沒寫過這四個 `meta` 欄位。`8.1`/`8.3` 顯示
PASS 純粹是 `_finite()` 找不到值時回傳的預設值 `0` 剛好落在窗口內
（`8.1` 窗口含 0、`8.3` 窗口含 0）——跟 R7 之前的 `6.1`–`6.3`、R9 之前
的 `7.5` 是同一種假 PASS，這次連 `8.1`/`8.3` 都要當未測量處理。

---

## 這次不太一樣：`8.2`／`8.4` 描述的功能現在不存在

**`8.2 input_buffer_window_ms`**（漂移鍵提前輸入的緩衝）：現行
`#stepDriftState()` 的進入條件是 `driftHeld && |steer|>0.0001 &&
speed>=DRIFT_ENTRY_SPEED` 每 tick 直接判定，沒有任何「提前按下先記著，
條件滿足時才生效」的緩衝機制。

**`8.4 steer_deadzone`**：`setInput()` 對 `steer` 只有 `clamp(-1,1)`，
沒有死區處理——極小的類比輸入值會直接生效，不會被視為「沒在操作」。

**這兩項可能是真的缺功能，不是缺量測。** 跟前幾輪（`6.1`–`6.3`、
`7.3`/`7.4`）不一樣：那些是「物理行為已經存在，只是沒被記錄／量測出來」，
這次是「這個機制本身可能還沒被實作」。你自己判斷：

- 如果你認為這是合理且該做的輸入處理（緩衝、死區是標準賽車遊戲功能，
  對 `CHARACTERS.md` 的兒童向受眾尤其有意義——死區太小的話幼童手指
  的小抖動會被當成轉向輸入），就實作它
- 如果你認為現在做這個為時過早（例如覺得應該先確認鍵盤/觸控的實際
  輸入特性，等 W3 或更後面再做），寫進 `loop/BACKLOG.md` 說明理由，
  不強求

**`8.1`（輸入延遲）本質上是可以直接測的**：`advance()` 在每個 tick
呼叫 `setInput()` 後立刻呼叫 `step()`，架構上延遲應該趨近於 0。這項
建議直接補量測（不需要新功能），確認现行架構真的符合窗口。

---

## 完成的定義

- [ ] `8.1` 有真實量測（不是預設值巧合）
- [ ] `8.2`/`8.4` 要嘛實作緩衝/死區機制並量測，要嘛在 BACKLOG 說明
      為何本輪不做——兩種都可以，但不要維持「假 PASS／看起來測了但
      其實沒有」的狀態
- [ ] `8.3` 有真實量測
- [ ] §2/§3/§4/§5/§6/§7（尤其 `4.5`、`6.1`–`6.3`）不退化
- [ ] ghost-replay 三次仍 byte-identical
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] 新的 `loop/round-10/VERDICT.json` 你自己產生，schema 驗證通過
- [ ] `loop/budget.json` 的 `input-feedback.spent` 更新——**這次麻煩記錄
      準確一點**，R9 回報的 1135659 跟這輪的改動量級明顯不成比例
      （R9 只改 telemetry 沒動物理，花費卻是 collision-response 的
      7 倍多），已記入 BACKLOG 待確認，這輪的數字要經得起同樣的檢查

## 不要做

不要碰 `drift-miniturbo`／`steering-grip`／`collision-response`／
`airborne-landing` 已經調好或已經誠實記錄的部分。

## 實作方式由你決定

緩衝/死區要不要做、怎麼做，你自己判斷。
