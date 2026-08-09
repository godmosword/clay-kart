# R33 給 Codex 第二件（ck-physics）

上一件我獨立驗過了，**全部照規格做到**，而且硬體 GL 那條的效果比預期大得多：

```
render_backend  hardware_gl
gl_renderer     ANGLE (Apple, ANGLE Metal Renderer: Apple M4, ...)   ← 真的量到的
fps_p50         6.33 → 59.88
4.1  12.136  [11.5, 12.5]  PASS   （而且是 hz 模式，因為 fps 回到 24 以上）
4.2  60.095  [58,   62]    PASS
4.3  60.095  [58,   62]    PASS
2.1–2.4                    PASS
```

三段窗口、`force_fail` 無條件覆蓋、`test_zero_animation_ratio_fails_...`、
SwiftShader 歸因——都在。17 項現在 16 項 PASS。

**兩件小事**：artifact 請直接寫進 `loop/round-33/artifacts/` 並 commit
（`loop/README.md` 那條我改成正面表述了，之前寫得容易誤讀成禁止寫 `loop/`）；
這一輪我已經幫你放進去了。

---

## 一、`§5.2` 結構性不可能通過——比賽只有 3 圈，而它要 5 圈

### 這是我上一輪的誤判

我把「只跑到 3 圈」歸因於軟體算繪太慢。**錯了。** 硬體 GL、59.88fps 之下
還是只有 3 圈：

```json
"initial_snapshot": { "current": 1, "total": 3, "time": 1.43 },
"completedLaps": 3, "targetLaps": 5, "status": "incomplete_five_lap_run"
```

`total: 3` 來自 `src/physics/world.ts:30`：

```ts
const TOTAL_LAPS = 3;
```

**比賽總長就是 3 圈。** `§5.2` 要求連續 5 圈，所以它從寫下來的那天起
**永遠不可能通過**——不是慢、不是 timeout（150s 對 5 圈 × 7.9s 綽綽有餘），
是規格跟遊戲互相矛盾。

這是這個專案追了八次那個家族的**又一個鏡像**：R28 把「不可能失敗」修成
「會失敗」，但修出來的是一個「不可能通過」。兩者一樣沒有資訊。

### 裁決：開 FROZEN 的閘，窄幅，只准這一件

`src/physics/world.ts` 在 `FROZEN.md` 裡（R22 PASS 46/46）。這道閘擋的是
「量測工具被悄悄放寬到剛好通過」，而這次要動的是**受測物的可設定性**，
不是那把尺——所以開閘，但範圍寫死：

**准許：** `WorldOptions` 加一個選用的 `totalLaps?: number`，
預設值**必須**是現行的 `3`，讓探針能要求 5 圈。

**明文禁止：**
- 不得改 `TOTAL_LAPS` 的預設值（那會改變遊戲本身，也會動到 `BAR-FEEL` 的 fixture）
- 不得改動 `world.ts` 的任何其他行為、常數、或 `§2`–`§8`／`§12` 的任何推導
- 不得為了讓 `§5.2` 通過而放寬它的窗口或改成 3 圈
- **`§4.10 drift_speed_retention` 的餘裕只有 0.00028（窗口跨度的 0.03%）。**
  跑完必須重跑 `feel.py` 確認 46/46 沒有回歸，這是交件條件

**交件必附：** 重跑 `ghost-replay` + `feel.py`，46 項逐項與 R22 對照，
以及 `§5.2` 在 5 圈下量到的真值（**可能是 FAIL，那沒關係**——這一輪的目的
是讓它變成一個能通過也能失敗的檢查，不是讓它通過）。

> 順帶：這一輪量到 `heapDeltaBytesRaw = -17990091`（堆積在 3 圈裡**縮小** 18MB）
> 被鉗制成 0。沒有洩漏是好事，但負值被靜靜夾成 0 會讓「回收得很好」跟
> 「沒測到」長得一樣。5 圈的版本請把 raw 值一起記進 artifact。

---

## 二、`perf-probe.mjs` 沒攔 instanced draw——`§5.3`／`§5.4` 從沒算過 InstancedMesh

`perf-probe.mjs:687-705` 只覆寫：

```js
prototype.drawElements
prototype.drawArrays
```

**而 `InstancedMesh` 走 `drawElementsInstanced`／`drawArraysInstanced`。**
`tools/visual/scene-stats.mjs` 有同一個洞（另外給 Cursor 了）。

怎麼發現的：我把葉瓣段數 6→10（面數 +67%，1440 片），`triangles_k`
**精確地還是 58.754**，一個位元沒動。補攔之後同一個場景：

| | 現行 | 補攔後 | 預算 |
|---|---|---|---|
| `draw_calls` | 142 | **168** | 150 → **超標** |
| `triangles_k` | 61.7 | **1617.7** | 400 → **超標 4 倍** |

（那組數字是我用 `scene-stats` 量的；`perf-probe` 的 148／58.754 有同樣的洞。）

`foliage.ts` 的註解自己寫著「所以每一樣東西都必須是 `InstancedMesh`」——
**元件做得越對，對量測就越隱形。**

### 要求

1. 攔 `drawElementsInstanced` 與 `drawArraysInstanced`，
   三角形數 `count / 3 × primCount`。兩個進入點可能不存在，取用前先判斷。
2. **不要動場景讓它回到預算內**——那是 `src/render/`，我的範圍。如實回報。
3. 回報 `1617.7` 的**組成**：純幾何算術估整個場景 foliage 約 251k，差 6 倍。
   是不是陰影 pass 重複算繪同一批 instance？建議按呼叫點分組印出來。
   **這個 6 倍沒有解釋之前，我不會拿新數字去改預算。**

---

## 交件

- 直接 commit 進 `loop/round-33/artifacts/`，push 到 `feat/physics`
- 回報 commit sha、實測數字（不要只寫 PASS）、動過的檔案
- `§5.2` 與 instanced 兩件可以分兩個 commit，但都要有實測值
