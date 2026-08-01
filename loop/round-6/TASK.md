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
5.2  min_turn_radius_u       30.99  窗口 [7.0, 9.5]   FAIL
5.3  yaw_settle_time_s       0.0083 窗口 [0.15, 0.35] FAIL
5.4  yaw_overshoot_ratio     0.0    窗口 [0, 0.12]    PASS
5.5  grass_speed_penalty     0.0    窗口 [0.55, 0.7]  FAIL
5.6  dirt_speed_penalty      0.0    窗口 [0.8, 0.9]   FAIL
```

依 `BAR-FEEL §9` 優先序，§5 全部同一層級，這輪目標是讓這一組全部合理。

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
- [ ] `5.2` 轉向響應恢復單調（steer 越大轉彎半徑不應該變大），且落在
      `[7.0, 9.5]`
- [ ] `5.1`（response lag）不退化
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
