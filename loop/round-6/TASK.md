# R6 — W2 手感：steering-grip

**Wave:** W2
**Element:** `steering-grip`（`loop/budget.json` cap 250k，見 `BAR-FEEL §5`）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R5 `de2ec80`——7.1/4.9/4.10 三項修正，我獨立驗證屬實。

---

## 為什麼換元件

`drift-miniturbo` 的硬門檻 `4.5` 從 R4 起穩定通過（R5 仍是 1.5156），
`4.9` 這輪也修好了。預算已花 626134（cap 400000，超支 56%），剩下的
`4.4`/`4.6`/`4.7`/`4.10` 記在 `loop/BACKLOG.md`，這輪不追。轉向下一個
元件：`steering-grip`（`BAR-FEEL §5`）。

---

## 現況（`loop/round-5/VERDICT.json` 的 §5 部分）

```
5.1  steer_response_lag_ms   8.33   窗口 [0, 50]      PASS
5.2  turn_radius_at_95pct_u  30.99  窗口 [7.0, 9.5]   FAIL   （原 min_turn_radius_u，改名見下）
5.3  yaw_settle_time_s       0.0083 窗口 [0.15, 0.35] FAIL
5.4  yaw_overshoot_ratio     0.0    窗口 [0, 0.12]    PASS
5.5  grass_speed_penalty     0.0    窗口 [0.55, 0.7]  FAIL
5.6  dirt_speed_penalty      0.0    窗口 [0.8, 0.9]   FAIL
```

依 `BAR-FEEL §9` 優先序，§5 全部同一層級，這輪目標是讓這一組全部合理。

**`BAR-FEEL.md §5` 這輪開工前多了三項（5.7/5.8/5.9），你的 `feel.py` 需要跟著補上**——
見下一節，這不是你漏做，是 bar 本身在你上輪交完後被 Lead 更新了。

---

## 5.2／5.3 是同一個根因：yaw 沒有慣性，而且轉向響應非單調

**5.3（yaw_settle_time）：** 放開轉向後 `yaw_rate` 一個 tick 內歸零
（`0.0083s`）。`#stepYaw()` 目前是 `yawRate = steer * MAX_STEER_YAW_RATE
* speedRatio * controlRatio`——直接映射，沒有任何平滑/慣性項，所以放開
瞬間 `yawRate` 也瞬間歸零。這條在 R1 就記錄過，那時的任務是先讓它
「可量測」，這輪才是真的調到窗口內。

**5.2（min_turn_radius）：這不是 fixture 覆蓋率問題，我已經排除這個可能。**
掃過整個轉向範圍，穩態 `yawRate` 對 `steer` 的關係不是預期的線性/單調：

```
steer=-0.1  yawRate=-0.1871  radius=117.38
steer=-0.2  yawRate=-0.4685  radius= 46.80
steer=-0.3  yawRate=-0.7594  radius= 29.68
steer=-0.4  yawRate=-0.9252  radius= 23.72
steer=-0.5  yawRate=-1.0287  radius= 21.76
steer=-0.6  yawRate=-1.0704  radius= 21.57   ← 全範圍最緊
steer=-0.7  yawRate=-1.0900  radius= 21.99
steer=-0.8  yawRate=-1.0583  radius= 22.66
steer=-0.9  yawRate=-1.0296  radius= 23.29
steer=-1.0  yawRate=-1.0049  radius= 23.87   ← 打滿方向盤反而比 -0.6 差
```

`yawRate` 在 `steer≈-0.6` 見頂，之後**打得更死轉得更少**，直覺上是錯的
（更大的轉向輸入應該至少不會讓轉彎半徑變大）。而且全範圍最佳半徑只有
`21.57`，離窗口 `[7.0, 9.5]` 還差一大截，所以就算修好非單調性，數值本身
也需要調。懷疑跟 `#stepDrive()` 裡的 `targetGroundSpeed` 重新縮放邏輯
有關（那段會把整個速度向量按比例縮放，可能在側向分量大的時候跟 yaw
計算產生非預期的回饋），但這是我的猜測，**你自己查根因，不要照抄我這句**。

**第二組證據，換一種量法，指向同一個更根本的問題：**半徑不只對「轉向輸入
大小」非單調，對「車速」根本無感。全程打滿舵、油門催到極速後放開讓車自然
減速，整個速度區間（2–22 u/s）實測半徑穩定在 `22.6–22.9`，幾乎是一條水平線。
正常的車速度越快轉彎半徑應該越大——現行模型完全沒有這個關係。這是
`BAR-FEEL §5` 這輪新增 `5.7`/`5.8`/`5.9` 的直接原因（見下）。

---

## 新增：5.7／5.8／5.9（三點測速 + 單調性），取代原本的單點量測

`BAR-FEEL.md §5` 已更新，`5.2` 改名為 `turn_radius_at_95pct_u`（窗口不變，
語意不變，只是跟新指標對齊命名），新增：

| ID | 指標 | 窗口 |
|---|---|---|
| 5.7 | `turn_radius_at_30pct_u` | `[3.5, 5.5]` |
| 5.8 | `turn_radius_at_60pct_u` | `[5.5, 7.5]` |
| 5.9 | `turn_radius_monotonic` | `true`（`5.7 < 5.8 < 5.2` 嚴格遞增） |

`feel.py` 目前只算單一半徑（`speed >= top_speed*0.95` 篩選幀取最小值）。
這輪需要改成在三個速度區間（約 30%/60%/95% 極速）分別取穩態半徑，並算出
`5.9` 的布林判定。**5.7/5.8 的窗口是 Lead 依 5.2 既有窗口外推的估計值**，
不是精確 calibration，如果實測後發現不合理，寫 `loop/BACKLOG.md`，
不要自己動 `BAR-FEEL.md`。

**這組指標的來源：** 一份外部設計提案主張大改 `BAR-FEEL §4/§5`，Lead 逐項
核實後**駁回了整份提案**——它的核心論證（`4.5` 現行定義出不來、`5.2` 在
各速度下實測 8.78–8.89）都跟現行程式碼的實測結果不符，兩個可查證的具體
數字都是錯的。**但其中「轉彎半徑該對速度做三點檢查」這個結構性診斷
被 Lead 獨立驗證是對的**（就是上面那段滿舵減速測試），所以只採納了這一項，
其餘（`§4` 重新定義、施工順序調整、預算重分配）全部沒有採納。你不需要
知道那份提案的其他內容，也不會再看到它。

**如果你想找根因，一個值得考慮的方向（不是指令，你自己判斷要不要用）：**
現行 `#stepYaw()` 是每個 tick 直接把 `steer` 映射成 `yawRate`，沒有任何
平滑項。轉向輸入端加一階低通（`weightedSteer ← rawSteer·r + weightedSteer·(1−r)`，
再用 `weightedSteer` 算 `yawRate`）是常見做法，可能同時解釋非單調（原始
`steer` 直接映射在speed/lateral耦合下可能產生非預期交互）與零慣性
（`5.3`）兩個現象，且比在 `yawRate` output 端做角動量積分更容易保持
決定性（純函式、單一純量狀態）。但這是否是根因、要不要這樣做，你自己判斷。

---

## 5.5／5.6：可能超出這輪範圍，先查清楚再決定

`surface` 目前在 `snapshot()` 裡是寫死的 `'asphalt'`——整條賽道只有
`TRACK_GEOMETRY` 定義的單一瀝青環，沒有草地/泥地區域的座標定義。

**如果賽道幾何裡真的沒有草地/泥地區域，這兩項本輪跳過，寫進
`loop/BACKLOG.md` 說明「需要賽道內容才能測，屬於之後的關卡內容範圍」。**
不要為了讓這兩項有東西可測，去發明一個賽道幾何裡不存在的草地區。
如果你認為這是合理的物理層工作（例如先做好『侦测 surface 並套用速度
懲罰』的機制，賽道內容之後再補），也可以做，但要在 `VERDICT.json` 的
`checks` 或 commit message 說明你的判斷。

---

## 完成的定義

- [ ] `5.3` 有合理的 settle time（窗口 `[0.15, 0.35]`），且 `5.4`
      （overshoot）不要因為加了慣性就跑出窗口
- [ ] `5.2`/`5.7`/`5.8` 三個速度點都有合理半徑，且 `5.9`（單調性）為 true
- [ ] `5.1`（response lag）不退化
- [ ] `feel.py` 的 `WINDOWS` 表補上 `5.7`/`5.8`/`5.9`，`5.2` 的 metric 名稱
      改成 `turn_radius_at_95pct_u`（跟 `BAR-FEEL.md` 對齊，避免 `VERDICT.json`
      的 `metric` 欄位跟 bar 文件對不上）
- [ ] `5.5`/`5.6` 要嘛有實測結果，要嘛在 BACKLOG 說明為何本輪跳過
- [ ] §2/§3/§4（尤其 `4.5`）不退化——這輪你會動 `#stepYaw()`，
      `driftRatio` 那段也在同一個函式裡，小心別連帶改到漂移的轉向倍率
- [ ] ghost-replay 三次仍 byte-identical
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] 新的 `loop/round-6/VERDICT.json` 你自己產生（**這次記得裝
      `jsonschema`：`pip install jsonschema` 或用你環境裡有的方式，
      R5 因為缺這個套件跳過了 schema 檢查，這輪別再跳過）
- [ ] `loop/budget.json` 的 `steering-grip.spent` 累加更新

## 不要做

不要碰 `drift-miniturbo` 相關常數（`DRIFT_*` 開頭那組）。不要為了衝
`5.2`/`5.3` 去動 §2/§3/§4 已經過的數值。

## 實作方式由你決定

yaw 模型要不要加二階平滑、用什麼曲線映射 steer 到穩態 yawRate，不要問我。
