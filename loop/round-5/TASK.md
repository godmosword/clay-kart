# R5 — W2 手感：修 R4 的代價，不是重做 drift

**Wave:** W2
**Element:** `drift-miniturbo`（`loop/budget.json` cap 400k，R4 已花 455678——**已超支，見下方**）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R4 `85e8f01`——**4.5 通過，我獨立驗證屬實**（1.5156 車身，三次獨立 process
byte-identical，重算數字與你回報一致，而且是真的雙跑比對——`ghost-replay.mjs`
確實另外跑一次 `drift:false` 的直線版本，用真實模擬位置算位移差，完全照
`BAR-FEEL §4` 的基準線定義做，不是湊數字）。但驗證時往下挖，發現四件事。

---

## 判定：R4 的核心成果保留，但有三個問題要處理才能繼續

**不是重做。** `driftState`/`driftCharge`/`driftTier` 狀態機、tier2 mini-turbo
釋放的實作邏輯是對的——`DRIFT_YAW_RATE_RATIO=1.4` 精準落在 `4.9` 窗口
`[1.25, 1.6]` 正中央，state machine 的進入/維持/釋放/提早放開四條路徑
都合理。這輪要修的不是物理，是這次改動的兩個副作用 + 一個驗證器缺陷。

---

## 問題一（真退化，優先修）：7.1 從 PASS 變 FAIL

**現況：** R3 是 `air_control_yaw_rate_ratio = 0.248`（PASS）。R4 變成
`0.0`（FAIL，窗口 `[0.2, 0.4]`）。

**根因（我追出來的，不用你重查）：** 跳躍發生在 tick 700–701。R3 的 fixture
在那個時刻 `steer=-0.3`；R4 重排後那段變成 `steer=0`（`brake=true` 的煞車段
一路蓋過跳躍那一瞬間）。空中沒有轉向輸入，`air_yaw` 自然算出 0。物理沒壞，
是 fixture 重排的附帶損害。

**要做的：** 讓跳躍發生時段保留非零 `steer`，讓空中真的有轉向輸入可測。
不用整份 fixture 重新設計，只要那個窗口附近的 segment 加回轉向即可。

---

## 問題二（驗證器缺陷，不是物理）：4.9 算出 33.78，是 `feel.py` 的鍋

**現況：** `drift_yaw_rate_ratio` 窗口 `[1.25, 1.6]`，算出 `33.78`。

**根因（我追出來的）：** R4 的 fixture 有 91%（6580/7200 tick）是
`steer=0` 的長煞車尾段（tick 701–6000 一路到底）。`feel.py` 目前的
`yaw_ratio` 計算：

```python
normal_yaw = [abs(yaw_rate) for f in frames if drift_state == "none"]
drift_yaw  = [abs(yaw_rate) for f in frames if drift_state != "none"]
ratio = mean(drift_yaw) / mean(normal_yaw)
```

`normal_yaw` 平均了全部 6795 個非漂移幀，其中 6580 個 `steer=0`（yaw_rate
恆為 0），把分母拖到 0.016。只看有轉向的非漂移幀（214 個非零樣本），平均
反而是 0.51——跟漂移幀平均 0.55 很接近，符合 1.4 這個設計值該有的量級。

**要做的：** 這是 `tools/validate/` 範圍，你自己的檔案，可以動。`yaw_ratio`
的分子分母都應該只採「有主動轉向」的幀（例如 `abs(steer_input) > 0.05`），
不要把長時間零轉向的幀混進平均——不然這個指標對任何 fixture 的『無關內容
佔比』都會很敏感，不只是這次。

**這是本輪唯一允許你動 `tools/validate/` 的理由。** 不要順便重構其他指標
的計算方式，只修 `drift_yaw_rate_ratio` 這一項的濾波邏輯。

---

## 問題三（假量測，比前兩項更該優先修）：4.10 是硬編碼常數回填，不是真的測

**現況：** `ghost-replay.mjs` 第 104 行：

```js
drift_speed_retention: 0.93,
```

直接把 `world.ts` 的 `DRIFT_SPEED_RETENTION` 常數寫進 meta，`feel.py` 讀到
這個數字跟自己比較，當然每次都 PASS。**這個指標現在不管物理怎麼調，
永遠回報 0.93，不管實際漂移中的速度保留率是多少。**

對照組：`4.5`（`car_lengths_gained_tier2`）的做法是對的——你在同一支腳本裡
已經另外跑一次 `drift:false` 的基準線、用真實模擬位置算位移差
（`driftReplays`/`baseline` 那段）。`4.10` 應該用**同一組資料**算：漂移
frames 的平均速度 ÷ 同時間範圍內基準線 frames 的平均速度，而不是回填常數。

**要做的：** 用 `driftReplays[0].frames` 裡 `drift_state !== 'none'` 的
frames 平均 `speed`，除以 `baseline.frames` 對應同一段 tick range 的平均
`speed`，取代第 104 行的硬編碼。

**這是本輪最該優先修的一項**，因為它意味著現在的 `VERDICT.json` 對 `4.10`
給的 `PASS` 沒有任何資訊量——跟 `perf-probe.mjs` 那三個防抽格常數是同一種
問題，只是這次出現在 `BAR-FEEL` 的核心管線裡。

---

## 問題四（記錄用，不強制這輪解決）：4.5 margin 只有 1.56%

`1.5156` 對窗口下限 `1.5`，只贏 `0.0156`（窗口寬度 1.0 的 1.56%）。技術上
PASS，但幾乎沒有緩衝——前面幾項修正如果連帶動到任何跟位移相關的路徑
（不應該，但提醒你注意），這個數字可能翻回 FAIL。**修完問題一二三之後，
重跑 `feel.py` 確認 4.5 仍是 PASS 再收工**，不要假設它不受影響。

---

## 預算：已超支，這輪先別再燒

R4 花了 455678，cap 是 400000，已經超支 14%。`BAR-FEEL §4.5` 的規則是
『撞 cap 4.5 還沒過』才需要停下來找我裁決——這裡 4.5 已經過了，所以嚴格說
不觸發那條規則，但既然已經超支，這輪**盡量控制在小修正範圍**（fixture 加
幾個 tick 的轉向、`feel.py` 一個過濾條件），不要再開新的大改動。如果這輪
做完還想繼續往 4.4/4.6/4.7 的 fixture 覆蓋率去補，先停下來寫
`loop/BACKLOG.md` 讓我裁決要不要加碼，不要自己決定繼續。

---

## 不歸這輪的（已知，記在 BACKLOG，不用處理）

- `4.4`/`4.6`/`4.7` 目前的 FAIL 很可能是 fixture 只測了單一 tier2 釋放路徑
  （drift 只維持 3.0s，未達 tier3 需要的 3.5s，且從沒測過提早在 tier1
  就放開的情境）。這是 fixture 覆蓋率問題，不是這輪的事
- `wall_stick_frames` 177→285，跟既有的 `min_turn_radius` 過大問題有關，
  屬於未來 `steering-grip` 元件的範圍
- `perf-probe.mjs` 的防抽格檢查是寫死常數（`loop/BACKLOG.md` 已記錄，
  觸發點是 W3 開工前）

---

## 完成的定義

- [ ] `7.1 air_control_yaw_rate_ratio` 恢復 PASS，且是真的測到空中轉向，
      不是又剛好蒙對
- [ ] `4.9` 的計算邏輯修正，新數值落在合理範圍（不要求一定要 PASS，但
      不該再是 33 這種離譜倍數——如果修完還是 FAIL，那至少是可信的 FAIL）
- [ ] `4.10` 改成從 `driftReplays`/`baseline` 的真實 frames 算出來，
      不是硬編碼常數——PASS 與否都可以，但要是真的測出來的
- [ ] `4.5` 修完問題一二三後重新確認仍是 PASS
- [ ] §2/§3 不退化
- [ ] ghost-replay 三次仍 byte-identical
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] 新的 `loop/round-5/VERDICT.json` 你自己產生
- [ ] `loop/budget.json` 的 `spent` 累加更新（不是覆蓋，R4 已花的 455678
      要保留，這輪的花費加上去）

## 實作方式由你決定

fixture 怎麼調整、`feel.py` 的過濾條件寫成什麼形式，不要問我。
