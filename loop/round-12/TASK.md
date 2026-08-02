# R12 — 回收兩個既有 BACKLOG 缺口：落地水平減速（7.3/7.4）與輸入緩衝/死區（8.2/8.4）

**Wave:** W2
**Element:** `airborne-landing`（cap 150000，見 `BAR-FEEL §7`）+
`input-feedback`（cap 100000，見 `BAR-FEEL §8`）——**這輪同時處理兩個
已完工元件的殘留落差，不是新元件**
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R11 `88c102d`——多車架構、kart-kart 碰撞（6.4=1.0 PASS），
我獨立驗證屬實（重跑 typecheck/build/pytest、重新產生 telemetry 餵
feel.py 算出跟你的 VERDICT.json 逐項零差異）。**但發現這個 commit 當時
沒併進 main**，只有 telemetry/BACKLOG/budget 紀錄檔併了——已由我手動
merge 補上（main commit `66b4ff3`），現在 main 的 `npm run typecheck`/
`build`/`pytest` 都是綠的。**這是同一類「程式碼漏併入 main」疏漏第四次
發生**，麻煩這輪收尾時比照 `loop/README.md` 的 `git merge-base
--is-ancestor` 檢查自己確認一次，不要只回報 commit hash。

---

## 這輪要做什麼

### 1. `airborne-landing`：7.3/7.4 落地速度保留率超出窗口

R9 已經把根因拆清楚了（見 `loop/BACKLOG.md`「airborne-landing —
7.3/7.4 落地速度保留率仍超出窗口」），這輪要真的處理，不是重新診斷：

```
7.3 landing_speed_retention  1.0019  窗口 [0.90, 1.00]  FAIL（略超上限）
7.4 hard_landing_retention   0.9607  窗口 [0.70, 0.85]  FAIL（明顯超出）
```

**7.3 是量測邊界效應，不是物理設計問題**：`smooth` probe 全程
`throttle=1`，落地那個 tick 裡 `#stepVertical()` 把 `vy` 歸零跟
`#stepDrive()` 的引擎推力剛好在同一個 tick 內發生（`step()` 的執行順序
是 `#stepDriftState → #stepVertical → #stepYaw → #stepDrive →
#stepPosition → #resolveTrackCollision`），所以 `ghost-replay.mjs` 的
`landingData()` 量到的 `currentGroundSpeed`（落地那一幀）已經混入了
一整個 tick 的正常加速度，製造 0.19% 的假性增速。這條路可能的方向：
落地那個 tick 的 ground speed 取樣點要挪到引擎推力套用之前——可能是
`world.ts` 要暴露一個更精確的取樣時機，也可能是 `ghost-replay.mjs` 那邊
換一種算法（例如改用落地瞬間的水平速度分量而非落地後一整個 tick 的
結果）。這是我的猜測方向，不是指令，你判斷怎麼做最乾淨。

**7.4 是真正的物理缺口**：現行模型落地時只有 `vy` 歸零
（`#stepVertical()` 的 `if (this.#y <= 0) { this.#y = 0; this.#vy = 0;
this.#grounded = true; }`），`vx`/`vz` 完全不受影響——不管落地角度多陡，
水平速度都不會被削減。要讓 7.4 落進窗口，需要在落地時依撞擊角度耦合
一個水平減速機制。R9 提過一個可能方向：類比 `#resolveTrackCollision()`
現有的 `grazingBlend`/`wallBounce` 分段邏輯（用入射角分段決定反彈係數），
落地角度可以用落地瞬間速度向量跟垂直方向的夾角定義（`landingData()`
已經在算 `landing_angle_deg` 了，可以直接借用同一個定義）。同樣是猜測
方向，不是指令，唯一禁止的是為了湊數字發明不存在的落地類型分支。

**附帶**：`loop/budget.json` 記錄 R9 的 `airborne-landing.spent =
1135659`（cap 150000，超支 657%），跟 R7 同量級改動花費 149104 明顯不
成比例，已在 BACKLOG 標記「疑似記錄錯誤」待你確認。這輪如果查得出來
當時是不是筆誤，麻煩一併澄清；查不出來就照實記錄這輪的花費，不用回頭
硬改 R9 的數字。

### 2. `input-feedback`：8.2 drift 緩衝／8.4 steer 死區尚未實作

R10 的任務把是否要做這兩個功能的判斷權交給你，你當時選擇不做、記進
BACKLOG。現在裁決是：**要做**。

```
8.2 input_buffer_window_ms  0  窗口 [80, 130] ms   FAIL
8.4 steer_deadzone          0  窗口 [0.05, 0.15]   FAIL
```

**8.2**：`#stepDriftState()` 的進入條件（`driftHeld && |steer|>0.0001 &&
speed>=DRIFT_ENTRY_SPEED`）目前每 tick 直接判定，玩家在條件滿足前提早
按下 drift 鍵會被完全忽略。需要加一個提前輸入緩衝——按下的時間點記著，
若在 `[80,130]` ms 內條件滿足就補觸發。

**8.4**：`setInput()` 對 `steer` 只有 `clamp(-1,1)`，沒有死區。極小的
類比輸入值會直接生效。需要加一個 `[0.05,0.15]` 範圍內的死區——低於
門檻視為沒有轉向輸入。

**兩者都要注意回歸風險**：死區可能影響 §5（尤其 `5.3` yaw_rate 歸零
時間、`5.7`–`5.9` 的轉向半徑量測，那些 probe 常常掃過很小的 steer 值）；
緩衝可能影響既有 `4.x` 系列依賴精確 drift 觸發時機的指標（尤其
`4.5`——**唯一硬門檻，不能退化**）。這輪的完成定義包含全指標掃描，
如果死區/緩衝動到既有窗口，要嘛調整實作方式避開，要嘛如實回報哪個
指標退化、退化多少，不要為了兩個新指標通過而讓 `4.5` 掉出窗口。

---

## 完成的定義

- [ ] `7.3` 落在 `[0.90, 1.00]`，`7.4` 落在 `[0.70, 0.85]`（若量測面調整
      後仍調不進窗口，如實記錄實際數字與已嘗試的方向，不要虛構物理
      分支硬湊）
- [ ] `8.2` 落在 `[80, 130]`，`8.4` 落在 `[0.05, 0.15]`
- [ ] `4.5`（硬門檻）不退化——這是唯一不可談判的項目
- [ ] §2/§3/§4 其餘／§5/§6/§7 其餘（7.1/7.2/7.5）/§8 其餘（8.1/8.3）
      全指標掃描，如有退化如實記錄，不要隱藏
- [ ] ghost-replay 三次仍 byte-identical
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `pytest` 全數通過
- [ ] 新的 `loop/round-12/VERDICT.json`，schema 驗證通過
- [ ] `loop/budget.json` 的 `airborne-landing.spent`／
      `input-feedback.spent` 更新為這輪實際花費（在原本的數字上累加，
      不是取代）
- [ ] **收尾前自己跑一次 `loop/README.md` 的 merge-base 檢查**，確認
      `feat/physics` 的所有 commit 真的在 `main` 的祖先鏈裡，不是只有
      紀錄檔併了

## 這輪不做什麼

- 不碰 `6.5`（wall stick）——沒被排進這輪，跟這輪範圍無關
- 不做 AI 決策邏輯／per-character 調校——那還在等 Lead 補 `BAR-FEEL`
  行為指標
- 不重新診斷 7.3/7.4/8.2/8.4 的根因——R9/R10 已經查清楚了，這輪是
  處理，不是重查

## 實作方式由你決定

落地水平減速的具體公式、輸入緩衝/死區的實作細節（怎麼記提前按下的
時間點、死區用 hard cutoff 還是平滑過渡）都你決定。唯一不能動的是
`4.5` 不退化這條線。
