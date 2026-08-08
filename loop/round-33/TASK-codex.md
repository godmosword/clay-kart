# R33 給 Codex（ck-physics）

R28 的兩條、R32 的兩條，你都做對了。我這一輪自己重跑了一次完整探針
（`6259abb`、M4 MacBook Air、非信任 artifact），先把驗證結果講完，再講新的。

## 已驗證通過的部分

**`§5.2` 連續五圈——機制正確。** `HEAP_REQUIRED_LAPS` 單一常數、
`measureHeapRace()` 裡只有一個 `Page.navigate`、`perf-probe.mjs:786` 還留了
「never sum independent runs」的註解。我這台只跑到 3 圈就撞 timeout，
於是 `heap_measurement_status = incomplete_five_lap_run`、
`heap_growth_per_lap_mb = None` → 誠實 FAIL，**沒有按比例外推**。
這正是 R28 要求的行為，通過。

**`§4.1` 的 Nyquist 前提——切換邏輯正確。** `fps_p05 = 3.118 < 24` 時確實切到
ratio 模式，缺值走 `MISSING` → `actual=None` → FAIL。R28 擔心的
「未判決變成永遠不會失敗」沒有發生。切換這一半通過。

---

## 一、`§4.1` 的 ratio 窗口在它自己的適用範圍外會**誤判**，兩個方向都會

### 現況

[`tools/validate/perf.py:172-178`](../../tools/validate/perf.py#L172-L178)：

```python
return ("character_animation_per_frame", metrics.get(...), 0.0, ANIMATION_RATIO_MAX)  # 0.95
```

hz 模式的 `[11.5, 12.5]` 是**雙邊**的——動畫太快（逐幀）跟太慢（停住）都會 FAIL。
ratio 模式只有上界。

### 先講數學，因為它決定了修法

`ratio = characterAnimationFrames / renderedFrames`。動畫量化在 12Hz、
算繪率 `f`，正確實作應該給出：

```
ratio = min(1, 12 / f)
```

| 算繪率 f | 正確實作的 ratio | 現行窗口 [0, 0.95] 判成 |
|---|---|---|
| f > 24 | — | 不適用，走 hz 模式 |
| 12.63 < f ≤ 24 | 0.50 – 0.95 | **PASS ✓ 正確** |
| f ≤ 12.63 | **1.0**（每幀都換格，因為動畫比算繪還快） | **FAIL ✗ 誤判** |
| 動畫凍住（任何 f） | 0.0 | **PASS ✗ 誤判** |

**所以這個窗口只在 `12.63 < f ≤ 24` 這條窄帶內成立。** 帶外兩端各錯一次，
而且錯的方向相反。

### 這不是推導，是我實測到的

我這一輪的 artifact（`meta.build_sha = 6259abb`）：

```
fps_p50                        6.325
fps_p05                        3.118
character_animation_per_frame  1.0      → 4.1 FAIL
character_anim_hz              6.086
counter_deltas  renderedFrames 31 / characterAnimationFrames 31
```

**`driver-face.ts` 的量化實作從 R20 起一行沒動。** 6.3fps 下 12Hz 動畫本來就
必須每幀換格，`ratio = 1` 是**正確答案**，卻被判 FAIL。這是誤判，不是回歸。

你自己在 artifact 裡寫的 `character_anim_validation.conclusion` 是
「only quantization is tested; 12Hz frequency is not resolvable at this
sampling rate」——**結論寫對了，窗口沒有把它編碼進去。**

### 要求

分成三段，每一段的窗口必須反映那一段實際能解析什麼：

1. **`f > 24`**：維持 hz 模式 `[11.5, 12.5]`，不動。
2. **`12.63 < f ≤ 24`**：ratio 模式，改成**繞著 `12/f` 的雙邊窗口**
   （例如 `[0.85 × 12/f, min(0.95, 1.15 × 12/f)]`，係數你定，寫清楚理由）。
   這一段能抓「凍住」也能抓「逐幀」。
3. **`f ≤ 12.63`**：`ratio` 恆為 1，**對動畫頻率完全沒有資訊**。
   這一段**不得回報 PASS**，也不該回報一個看起來像動畫壞掉的 FAIL。
   要求回報 FAIL 且理由明講是環境：例如
   `character_anim_unmeasurable_render_too_slow`，並在 `delta` 裡寫出 `f`。

**明文禁止**：不得為了讓帶外變成 PASS 而加任何 fallback。
`§1.1`／`§4.4` 的「未判決不是 PASS」照樣適用——第 3 段是 FAIL，
只是 FAIL 的理由要指向環境而不是指向 `driver-face.ts`。

**測試要求**：`test_perf.py` 目前測了 ratio `0.8`（PASS）與 `1.0`（FAIL）。
補上 **`ratio = 0.0` 必須 FAIL**（現在會 PASS，這是這條的核心）、
以及三段邊界各一筆。

---

## 二、量測環境已經量不動這個場景了

### 現況

同一份 artifact，同一台 M4 MacBook Air：

```
fps_p50   6.325     窗口 [58, 62]
fps_p05   3.118     窗口 [55, 62]
draw_calls  148
meta.environment.device_note
  "Chrome headless ANGLE/SwiftShader proxy; not a real iPad/Android measurement"
```

**`SwiftShader` 是軟體算繪，沒有走 GPU。** R16 在同一支探針上量到
`fps_p50 = 59.88`——那時候場上是 W1 的方塊車，`draw_calls = 5`。
現在是 148 次 draw call 的黏土場景。不是程式變慢，是**軟體算繪撐不起這個場景**。

### 為什麼這要當成一條缺陷而不是「機器爛」

17 項檢查裡有 **8 項**（`4.1`／`4.2`／`4.3`／`2.1`／`2.2`／`2.3`／`2.4`，
外加 `5.2` 跑不完五圈）**全部倒在同一個原因上**。這 8 個 FAIL 沒有攜帶
任何關於這個遊戲的資訊。

這是這個專案追了六次的那個形狀的**鏡像**：

> 一個不可能失敗的檢查沒有資訊。
> **一個不可能通過的檢查同樣沒有資訊。**

而且更難發現——因為 FAIL 看起來像在工作。

### 要求

1. **把 GL renderer 字串記進 `meta`**：`WEBGL_debug_renderer_info` 的
   `UNMASKED_RENDERER_WEBGL`。現在的 `device_note` 是**寫死的字串**，
   不是量到的——它剛好講對了，但它不會因為換了硬體 GL 而改變。
2. **先試硬體 GL**：macOS headless 上試 `--use-angle=metal`
   （或 `--enable-gpu` + `--use-gl=angle`）。成功就用，`meta` 記下實際後端。
3. **失敗時明確標記**：`meta.render_backend = "swiftshader_software"`，
   而且時間性指標（`§2.1`–`§2.4`、`§4.2`、`§4.3`、`§4.1` 第 3 段）的 FAIL
   理由要指向後端，不是指向應用程式。

**同樣明文禁止**：不得因為偵測到軟體算繪就讓那些指標變成 PASS 或跳過。
這一條的目的是讓 FAIL 說「在 SwiftShader 6.3fps 下量的，應用程式效能未知」，
而不是說「應用程式很慢」。**兩者都不是 PASS。**

4. 如果硬體 GL 在 headless 下就是拿不到（很可能——macOS headless Chrome
   對 Metal 的支援一直不穩），**不要硬幹**。回報結論，我來重新想
   `BAR-PERF` 的時間性指標要在哪裡量（可能得改成有頭模式或換機器）。
   這比生一個能跑但沒意義的數字有價值。

---

## 交件要求

- artifact 與 VERDICT 一起 commit 進 `loop/round-33/artifacts/`，
  不得再出現 `artifacts` 指向容器暫存路徑
- `meta.build_sha` 必須是你實際跑的那個 build
- 完成後把程式碼 push 到 `feat/physics`，並在回報裡明講 commit sha
  ——**不要自己 merge 進 main**，收尾由我做

## 一件跟你無關但你會看到的事

`ck-physics` 的分支頭在這一輪之前落後 main 七個 commit（你之前那四個 perf
commit 是我重新 commit 到 main 的，分支本身沒動）。我已經把三個 worktree
全部同步到 `6259abb`，舊頭打了 `pre-sync/feat-physics-r32` 標籤。
你現在看到的樹就是 main。
