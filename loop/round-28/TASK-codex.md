# R28（Codex）— 兩條結構性不可能失敗的檢查

**Wave:** W3（`BAR-PERF` 基礎設施）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**可寫範圍:** `src/physics/`、`src/ai/`、`tools/telemetry/`、`tools/validate/`
**前一輪:** `bcc6fd7` —— `§4` 的算繪計數器已接通，`4.1` 真量測、`4.2`/`4.3` 有比值

---

這兩條都是同一類問題，這個專案已經抓過四次：`§4` 從 R3 到 R16 寫死常數、
`§2.5`/`§5.5` 用 `_finite()` 把缺值正規化成 0、`§4.1` 的 `not_applicable`
在臉接進遊戲之後過期兩個 wave、`4.2`/`4.3` 是 `renderedHz` 的別名。

**共同形狀：數字有在跑，但它不可能失敗。**

---

## 一、`§5.2 heap_growth_per_lap_mb` 沒有數圈（優先）

### 現況

`tools/telemetry/perf-probe.mjs`：

```js
heap_growth_per_lap_mb: heap.length > 1 ? Math.max(0, heap.at(-1) - heap[0]) : null
```

那是 **`meta.measurement_seconds = 5` 這個窗口的首尾差**，貼上 `per_lap` 的標籤。
程式裡沒有任何地方數圈。

### 為什麼這是缺陷不是取捨

`BAR-PERF §5.2` 的說明欄自己寫著：

> **5.2 是唯一必須跑五圈才測得出來的指標。** 其餘單圈即可。

而賽道周長 `2π × 30 ≈ 188` 單位、`BASE_TOP_SPEED = 24`——**一圈至少 7.9 秒，
5 秒連一圈都跑不完**。Lead 實測 `heap_growth_per_lap_mb = 0.3936`，
窗口 `[0, 2]` PASS。那個 PASS 不可能失敗：真正的洩漏在五圈裡可能遠超 2MB，
五秒裡看起來就是 0.39。

`§6` 把 `5.2` 排在優先序第三，理由是「記憶體洩漏會讓長時間遊玩崩潰」——
正是那種開發機跑五秒絕對看不出來、上線後才炸的東西。

### 要做的事

1. **量測窗口要真的跑滿五圈**，不是五秒。圈數從模擬狀態判定（`SimSnapshot`
   已有 `laps`），不要用時間估算——時間估算在幀率低的機器上會少跑
2. `heap_growth_per_lap_mb` = 五圈的堆積成長 ÷ 5，或直接量每圈的差取平均。
   **哪一種都可以，但要在 artifact 裡寫明用了哪一種**
3. artifact 記下實際跑了幾圈（`meta.laps_measured`），讓「有沒有跑滿」
   可以被檢查
4. **跑不滿五圈就明確 FAIL**，不得用「跑了幾圈就算幾圈」的比例外推——
   那會讓「跑不完」看起來像「沒有洩漏」

### 明確不要做的事

- 不要改 `§5.2` 的窗口 `[0, 2]`
- 不要為了縮短時間而降低 tick 率或跳過渲染。五圈就是五圈，慢就慢
- 其餘指標（`§2`、`§3`、`§4`、`5.1`、`5.3`–`5.5`）**維持單圈/短窗口**，
  `§5.2` 說得很清楚「其餘單圈即可」。不要順手把整支探針的窗口都拉長

---

## 二、`§3.1 first_interactive_s` 沒有 4G 節流

### 現況

`§3.1` 的窗口說明是「首屏可操作，**4G 網速**」。而探針裡**沒有任何
`Network.emulateNetworkConditions`**——Lead grep 過，唯一的 `throttle` 匹配是
車子的油門輸入。

實測 `first_interactive_s = 0.088`（localhost，無節流），窗口 `[0, 3.0]`。
又一個不可能失敗的檢查。`§3.4 time_to_first_render_s = 0.669` 是同一個問題的
較弱版本。

### 要做的事

用 CDP 的 `Network.emulateNetworkConditions` 套 4G 條件再量 `§3.1`／`§3.4`。
數值取業界常用的 4G profile 即可（例如 4 Mbps 下行、20 ms RTT），
**但要把用了哪一組參數寫進 `meta`**——不同 profile 差很多，沒記下來的話
下一輪的數字不可比。

### 明確不要做的事

- 不要改窗口
- 不要對 `§2`（幀率）套網路節流。那條量的是算繪，跟網路無關

---

## 完成的定義

- [ ] `§5.2` 跑滿五圈才給值，`meta.laps_measured` 記實際圈數，跑不滿明確 FAIL
- [ ] artifact 寫明 `§5.2` 用的是「總成長 ÷ 5」還是「每圈差取平均」
- [ ] `§3.1`／`§3.4` 在 4G 節流下量測，`meta` 記下 profile 參數
- [ ] 其餘指標的窗口與數值**不受影響**（跑完前後對照，`§2`／`§4`／`5.1`／
      `5.3`–`5.5` 的 status 逐項相同）
- [ ] pytest 全數通過，含針對「跑不滿五圈」與「缺 4G profile 記錄」的新測試
- [ ] artifact 的 `meta.build_sha` 正確（`loop/schema/provenance.py` 會檢查）
- [ ] **不得動任何凍結檔**：`tools/validate/feel.py`、`test_feel.py`、
      `src/physics/world.ts`、`src/physics/constants.ts`、`src/ai/controller.ts`、
      `src/contract/sim.ts`、`tools/telemetry/runtime.mjs`

## 收尾

依 `loop/README.md` 的三道檢查：`git status --short`、`merge-base`、
`python3 loop/schema/provenance.py`。**commit 之後記得 push**——R26 那次
提交了但沒推，Lead 是用本地分支合併的。
