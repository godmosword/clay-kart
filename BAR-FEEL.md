# BAR-FEEL — 手感標準

> W2 的唯一真實來源。`tools/validate/feel.py` 直接讀這份文件的數值窗口。
> **修改此文件等同修改驗收標準** — 只有 Lead 可以改，且必須在 `loop/BACKLOG.md` 留下理由。
>
> 所有窗口皆為 **閉區間 [min, max]**。單位標註於指標名稱。
> 「車身」= 1 car length = 2.4 世界單位（見 §1 常數）。

---

## §1 Telemetry 契約

### 1.1 常數

| 名稱 | 值 | 說明 |
|---|---|---|
| `TICK_HZ` | 120 | 物理固定步長，1/120 s |
| `CAR_LENGTH` | 2.4 | 世界單位，所有「車身」換算基準 |
| `BASE_TOP_SPEED` | 24.0 | 世界單位/秒，無道具無 turbo 的平地極速 |

### 1.2 輸出格式

`tools/telemetry/ghost-replay` 對每個 fixture 輸出一份 JSON：

```json
{
  "meta": {
    "fixture": "lap-a",
    "tick_hz": 120,
    "total_ticks": 7200,
    "build_sha": "abc1234",
    "seed": 20260730
  },
  "frames": [
    {
      "t": 0.0083,
      "tick": 1,
      "pos": [0.0, 0.0, 0.0],
      "vel": [0.0, 0.0, 0.0],
      "speed": 0.0,
      "yaw": 0.0,
      "yaw_rate": 0.0,
      "steer_input": 0.0,
      "throttle_input": 1.0,
      "drift_state": "none",
      "drift_charge": 0.0,
      "drift_tier": 0,
      "grounded": true,
      "surface": "asphalt",
      "collision_impulse": 0.0
    }
  ],
  "events": [
    { "tick": 240, "type": "drift_start", "data": {} },
    { "tick": 492, "type": "miniturbo_release", "data": { "tier": 2 } },
    { "tick": 900, "type": "collision", "data": { "normal": [1,0,0], "impulse": 12.4 } }
  ]
}
```

**欄位規範**

| 欄位 | 型別 | 必填 | 備註 |
|---|---|---|---|
| `t` | float | ✓ | 秒，= `tick / TICK_HZ`，須精確可重現 |
| `tick` | int | ✓ | 從 1 遞增，不得跳號 |
| `pos` / `vel` | float[3] | ✓ | 世界單位 |
| `speed` | float | ✓ | `norm(vel)`，冗餘但方便驗證器 |
| `yaw` | float | ✓ | 弧度，範圍 `[-π, π]` |
| `yaw_rate` | float | ✓ | 弧度/秒 |
| `steer_input` | float | ✓ | `[-1, 1]` |
| `throttle_input` | float | ✓ | `[0, 1]` |
| `drift_state` | enum | ✓ | `none` \| `charging` \| `released` |
| `drift_charge` | float | ✓ | `[0, 1]`，達 1 後不再累積 |
| `drift_tier` | int | ✓ | `0`\|`1`\|`2`\|`3` |
| `grounded` | bool | ✓ | |
| `surface` | enum | ✓ | `asphalt` \| `dirt` \| `grass` \| `boost` |
| `collision_impulse` | float | ✓ | 該 tick 的碰撞衝量，無碰撞為 `0.0` |

`events` 型別集合：`drift_start`, `drift_tier_up`, `miniturbo_release`, `collision`, `airborne_start`, `landing`, `respawn`。

### 1.3 決定性要求（硬性）

同一份 fixture 連跑三次，輸出必須 **byte-identical**。這是 W2 所有其他驗收的前提。
禁止：讀取 wall-clock、未固定種子的亂數、依賴 `Map`/`Set` 以外的迭代順序、浮點累加順序隨執行緒變動。

---

## §2 固定 tick 與模擬穩定性

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 2.1 | `tick_dt_variance` | `[0.0, 0.0]` | 固定步長，變異必須為 0 |
| 2.2 | `replay_byte_identical` | `true` | 三次重播比對 |
| 2.3 | `max_penetration_depth` | `[0.0, 0.05]` | 世界單位，碰撞穿透 |
| 2.4 | `nan_or_inf_frames` | `[0, 0]` | 任何 NaN/Inf 即 FAIL |

---

## §3 加速與極速

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 3.1 | `time_to_50pct_topspeed_s` | `[0.55, 0.85]` | 靜止起步至 12.0 u/s |
| 3.2 | `time_to_95pct_topspeed_s` | `[2.60, 3.40]` | 靜止起步至 22.8 u/s |
| 3.3 | `top_speed_flat_us` | `[23.5, 24.5]` | 平地穩態極速 |
| 3.4 | `coast_decel_us2` | `[4.0, 6.5]` | 放開油門的減速度 |
| 3.5 | `reverse_top_speed_ratio` | `[0.30, 0.42]` | 倒車極速 / 前進極速 |

**設計意圖：** 起步要有「黏土偏重」的份量感，但不能拖到玩家覺得沒回應。3.1 的窗口下限就是「不拖」的界線。

---

## §4 漂移與 mini-turbo（W2 主戰場）

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 4.1 | `drift_entry_min_speed_us` | `[9.0, 12.0]` | 低於此速度不得進入漂移 |
| 4.2 | `tier1_charge_time_s` | `[0.75, 0.95]` | 進入漂移至 tier1 |
| 4.3 | `tier2_charge_time_s` | `[1.90, 2.10]` | 進入漂移至 tier2 |
| 4.4 | `tier3_charge_time_s` | `[3.30, 3.70]` | 進入漂移至 tier3 |
| 4.5 | `car_lengths_gained_tier2` | `[1.5, 2.5]` | **★ 全文件唯一「單獨 FAIL 即退回整波」的指標** |
| 4.6 | `car_lengths_gained_tier1` | `[0.6, 1.1]` | |
| 4.7 | `car_lengths_gained_tier3` | `[2.8, 4.0]` | |
| 4.8 | `miniturbo_duration_tier2_s` | `[0.90, 1.20]` | boost 持續時間 |
| 4.9 | `drift_yaw_rate_ratio` | `[1.25, 1.60]` | 漂移中 yaw_rate / 正常轉向 yaw_rate |
| 4.10 | `drift_speed_retention` | `[0.88, 0.97]` | 漂移中速度 / 直線同時刻速度 |

**輸入機制（R4 前補上，原本只定結果指標沒定觸發方式）：** `WorldInput.drift`
按住進入/維持，放開釋放。

- 進入條件：`drift` 為 true 且 `abs(steer) > 0`（不轉向不算漂移）且
  `speed >= drift_entry_min_speed_us`（4.1）——不滿足時 `driftState` 停在 `none`
- 維持期間：`driftState` 依累積時長走 `charging`，`driftTier` 依 4.2/4.3/4.4
  的時間門檻遞增，`driftCharge` 線性累積到 1（達 1 後不再增加，見 §1.2 定義）
- 釋放：`drift` 由 true 變 false 時，若當下 `driftTier > 0`，給予對應
  tier 的位移增益（4.5/4.6/4.7 車身數）與 `driftState` 短暫轉 `released`
  持續 `miniturbo_duration_tier2_s`（4.8，其餘 tier 由你決定合理縮放），
  之後回到 `none`
- 提早放開（`driftTier` 仍是 0）：直接回到 `none`，不給任何增益
- 漂移中轉向手感由 4.9/4.10 定義（yaw 更靈敏、速度小幅流失但不到失速）

**設計意圖：** 4.5 是整個 W2 的心臟，也是「賽車遊戲好不好玩」的唯一真正判準。滿意度來自「**一個彎道內**肉眼可見拉開一個明確身位」——低於 1.5 車身感覺沒用，高於 2.5 車身則不漂移的玩法完全不可行。

**★ 4.5 的特殊地位：** 這是本文件唯一一個「單獨 FAIL 就退回整波」的指標。其餘全部 PASS 而 4.5 FAIL 時，W2 仍不得結束、不得進 W3、相關檔案不得進 `FROZEN.md`。撞到 `budget.json` 的 cap 也不例外——4.5 未達標時由 Lead 裁決是否加碼，**不適用** LOOP-OPS §6 的「強制進入下一個元件」。

**基準線定義（4.5–4.7）：** 同一 fixture 跑兩次，一次全程漂移釋放，一次全程直線油門到底，取釋放後 2.0 秒的位移差 ÷ `CAR_LENGTH`。

---

## §5 轉向與抓地

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 5.1 | `steer_response_lag_ms` | `[0, 50]` | 輸入到 yaw_rate 達 63% 的時間 |
| 5.2 | `turn_radius_at_95pct_u` | `[7.0, 9.5]` | 滿舵，速度 ≈ 95% 極速（原 `min_turn_radius_u`，改名以跟 5.7/5.8 對齊語意，窗口不變） |
| 5.3 | `yaw_settle_time_s` | `[0.15, 0.35]` | 放開轉向至 yaw_rate < 5% |
| 5.4 | `yaw_overshoot_ratio` | `[0.0, 0.12]` | 回正過衝，越低越乾淨 |
| 5.5 | `grass_speed_penalty` | `[0.55, 0.70]` | 草地速度 / 柏油速度 |
| 5.6 | `dirt_speed_penalty` | `[0.80, 0.90]` | |
| 5.7 | `turn_radius_at_30pct_u` | `[3.5, 5.5]` | 滿舵，速度 ≈ 30% 極速 |
| 5.8 | `turn_radius_at_60pct_u` | `[5.5, 7.5]` | 滿舵，速度 ≈ 60% 極速 |
| 5.9 | `turn_radius_monotonic` | `true` | `5.7 < 5.8 < 5.2` 嚴格遞增；速度越快轉彎半徑應越大 |

**5.7–5.9 是 R6 前補上的（原 5.2 只在單一速度點量測）：** 用 R6 開工前的獨立
測試證實，現行 `#stepYaw()` 的轉彎半徑幾乎跟速度無關——全程打滿舵、油門到頂
後放開讓車自然減速，實測整個速度區間半徑穩定在 22.6–22.9，跟低速/高速無關。
單點量測（原 5.2）測不出這件事，只要那一點剛好落在窗口內就會誤判為合格。
5.9 的單調性檢查專門堵這個漏洞。

**5.7/5.8 的窗口是 Lead 依 5.2 既有窗口按比例外推的估計值，不是精確calibration**，
若實測後發現不合理（例如低速物理上就是需要更大半徑），回報 `loop/BACKLOG.md`
由 Lead 調整，不要自己動 `BAR-FEEL.md`。

---

## §6 碰撞回應

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 6.1 | `wall_speed_retention` | `[0.55, 0.75]` | 30° 擦牆後保留速度比 |
| 6.2 | `wall_head_on_retention` | `[0.05, 0.20]` | 正面撞牆 |
| 6.3 | `collision_recovery_time_s` | `[0.20, 0.45]` | 恢復可控的時間 |
| 6.4 | `kart_kart_impulse_symmetry` | `[0.92, 1.08]` | 雙方受力對稱性 |
| 6.5 | `wall_stick_frames` | `[0, 3]` | 貼牆卡住的 tick 數，越低越好 |

**設計意圖：** 6.1 的下限防止「擦一下牆就完全停住」的挫折感；上限防止玩家靠撞牆過彎。

---

## §7 空中與落地

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 7.1 | `air_control_yaw_rate_ratio` | `[0.20, 0.40]` | 空中轉向 / 地面轉向 |
| 7.2 | `gravity_us2` | `[26.0, 34.0]` | 世界單位/秒²，刻意高於現實以求緊湊 |
| 7.3 | `landing_speed_retention` | `[0.90, 1.00]` | 平順落地不應扣速 |
| 7.4 | `hard_landing_retention` | `[0.70, 0.85]` | 大角度落地 |
| 7.5 | `airborne_to_grounded_latency_ticks` | `[0, 2]` | 落地判定延遲 |

---

## §8 輸入與回饋

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 8.1 | `input_to_sim_latency_ticks` | `[0, 1]` | |
| 8.2 | `input_buffer_window_ms` | `[80, 130]` | 漂移鍵提前輸入的緩衝 |
| 8.3 | `throttle_deadzone` | `[0.0, 0.08]` | |
| 8.4 | `steer_deadzone` | `[0.05, 0.15]` | |

---

## §9 優先序（critic 選 largest_gap 的依據）

當多個指標同時 FAIL，`tools/validate/feel.py` 依下列順序選出**唯一**的 `largest_gap`：

1. **§2 全部** — 模擬不穩定時，其他所有數值都不可信
2. **4.5** `car_lengths_gained_tier2` — 核心手感
3. **§3 全部** — 基礎移動
4. **4.2 / 4.3 / 4.4** — 充能時距
5. **§5 全部** — 轉向
6. **§6 全部** — 碰撞
7. **4.1 / 4.6–4.10** — 漂移次要參數
8. **§7 全部** — 空中
9. **§8 全部** — 輸入
10. **§12 全部** — AI 對手行為，最新加入、範圍最窄，優先序最低

同一優先層級內有多項 FAIL 時，取**相對偏離最大**者：
`abs_deviation / window_width`，取最大值。

---

## §10 抽格規則（跨 bar 的硬性約束）

`CHARACTERS.md §3` 規定：**角色動畫抽格到 12fps，載具 transform 與相機維持 60fps。**

這條會直接影響手感感知，但**不在本 bar 驗收** —— 因為它是幀率議題而非模擬議題，
由 `BAR-PERF.md §4` 用 frame log 確定性檢查。

本 bar 的所有指標都在**模擬層**（120Hz tick）量測，與顯示層抽格無關。
若 builder 為了做定格感而把物理 tick 降到 12Hz，`BAR-FEEL §2.1` 會立刻 FAIL。

---

## §11 什麼不在這份 bar 裡

刻意不驗收，避免 builder 過度優化：

| 項目 | 去哪驗 |
|---|---|
| 幀率、載入、記憶體、抽格 | **`BAR-PERF.md`** |
| 任何視覺呈現 | **`BAR-VISUAL.md`** |
| 角色造型、IP 界線、配色 | **`CHARACTERS.md`** |
| 道具系統平衡 | W4，屆時另立 bar |
| AI 對手行為（超車決策、橡皮筋、難度分級） | **`§12`**，見下 |

> AI 對手的**碰撞回應**仍歸本 bar §6 —— 對手車撞上來的手感是玩家感受得到的。
> 不歸本 bar 的只有它的決策行為，決策行為的指標見 §12。

---

## §12 AI 對手行為

`loop/PLAN.md` 規定進入 `ai-opponents` 元件本身（不是 R11 那個純架構回合）
前，行為指標要先補進本文件。R11 已經把架構落地（`karts[]`/`playerIndex`、
`WorldOptions.aiOpponents`），R11-R13 的 AI 車全部是決定性的靜止佔位符
（`throttle=0, brake=true`），從沒真的開過。這節是那之後的第一步：讓
AI 對手真的會開車，並且開得出可驗收的差異。

**前提**：AI 車要能自主完成整圈才有資格談超車/橡皮筋/難度——沒有這個，
後面三項都無意義。

| ID | 指標 | 窗口 | 說明 |
|---|---|---|---|
| 12.1 | `ai_lap_completion` | `true` | AI 對手在標準 fixture 內自主完成一圈（不卡死、不永久脫離賽道） |
| 12.2 | `ai_overtake_time_s` | `[1.0, 8.0]` | 專用 probe：前方車以固定較低油門直線行駛，`difficulty=1.0` 的 AI 從落後位置出發，追上並超越所需時間 |
| 12.3 | `difficulty_lap_time_spread_s` | `[3.0, 20.0]` | 同一 fixture 下 `difficulty=0` 與 `difficulty=1` 兩台 AI 各自完成一圈的時間差 |
| 12.4 | `rubberband_speed_bonus_ratio` | `[1.0, 1.15]` | AI 落後玩家一段距離時，允許的最大速度加成（相對 `BASE_TOP_SPEED`）——上限故意抓緊，橡皮筋太猛會讓玩家覺得「AI 用作弊在追」 |

**設計意圖與已知的不確定性**：這四個窗口是第一版，跟 W2 其他所有窗口
一樣是 Lead 依據設計意圖訂的，不是先跑過程式碼量出來再訂——如果 Codex
實測出來某項窗口設得不合理（例如物理上不可能同時滿足 `12.2` 跟
`12.4`），照 `BAR-FEEL v2` 那次的處理方式：如實回報實際數字跟原因，
不要為了通過而扭曲 AI 行為，Lead 再裁決是否調整窗口。

**決定性要求（承接 §1.3、契約文件已寫明）**：AI 每 tick 的決策必須是
純函式，不得使用 `Math.random()`；若需要變化性，只能從 fixture 的
`seed` 衍生。`12.2`/`12.3`/`12.4` 的 probe 都需要是新的 deterministic
replay，不要從主 `lap-a` fixture（目前是單車，且暖胎後不涉及 AI 車）
硬湊。

**只做這一步不做的事**（避免下一輪 task 誤讀範圍）：
- 不要求 AI 會超車後回防、會用道具、會抄近路——那些是更進階的行為，
  這節只定義「能開、能追、難度有感、橡皮筋有界」四個最基本的指標
- 不要求 AI 在被超車後主動放慢「讓」玩家——本 bar 刻意只定義落後時的
  正向橡皮筋，「AI 領先太多被削速」是另一種設計哲學，會讓部分玩家覺得
  AI 作弊，這節不強制也不禁止，Codex 若要做記得補 BACKLOG 說明理由
- per-character 物理調校（`CHARACTERS.md` 的重量級/輕量級差異）仍不
  在這節範圍，AI 行為指標跟角色是誰無關，只跟 `difficulty` 有關
