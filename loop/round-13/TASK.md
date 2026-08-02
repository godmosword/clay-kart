# R13 — 回收剩餘兩個舊 BACKLOG 缺口：貼牆卡住（6.5）與草地/泥地速度懲罰（5.5/5.6）

**Wave:** W2
**Element:** `collision-response`（cap 200000，見 `BAR-FEEL §6`）+
`steering-grip`（cap 250000，見 `BAR-FEEL §5`）——**這輪同時處理兩個
已完工元件的殘留落差，不是新元件**
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R12 `c8c5265`——落地水平減速（7.3/7.4 PASS）、drift 緩衝與
steer 死區（8.2/8.4 PASS）。我獨立驗證屬實（重跑 typecheck/build/
pytest、重新產生 telemetry 餵 feel.py 算出跟你的 VERDICT.json 逐項零
差異，主 fixture 的 7200 frames/398 events 跟 R11 逐位元相同，零回歸）。
**但這個 commit 當時又沒併進 main**，只有紀錄檔併了——已由我手動 merge
補上（main commit `b4b5233`），現在 main 全綠。**這是同一類疏漏第五次
發生**，這輪收尾比照 `loop/README.md` 的 `git merge-base --is-ancestor`
檢查自己確認一次，不要只回報 commit hash。

---

## 這輪要做什麼

### 1. `collision-response`：6.5 貼牆卡住的判定過寬

```
6.5 wall_stick_frames  289  窗口 [0, 3]  FAIL
```

現行 `feel.py` 的算法（`tools/validate/feel.py` 附近 `max_stick`）是數
「`collision_impulse > 0` 的連續 frame 數」的最長段——這個定義**沒有看
速度**，所以「高速持續擦著彎道牆面滑行一段時間」跟「幾乎不動地卡在
牆角」會被算成同一種東西。R7 已經試過把純位置修正跟真正速度衝量分離
（`wall_stick_frames` 從 291 降到 289），但主 replay 的碰撞段本身約
291 tick、大部分時間速度仍在移動，只有末段才真的慢下來——這代表問題
不是碰撞衝量的計算方式，是「stuck」這個詞的定義本身太寬。

`loop/BACKLOG.md` 當時列了兩個方向，這輪由你決定選哪個或有沒有更好的
做法：

1. **量測面**：改 `wall_stick_frames` 的定義，只把「`collision_impulse
   > 0` 且速度低於某個門檻（例如 asphalt 極速的一個小百分比）」的連續
   frame 算進去，真正快速掠過牆面不算卡住
2. **物理面**：在 `World`/`Kart` 內部維護一個明確的「貼牆／滑動」接觸
   狀態（不是每 tick 從 impulse 反推），telemetry 直接輸出這個狀態，
   validator 不用再猜

兩個方向都不是指令，你判斷哪個更乾淨、風險更低。**唯一要求**：不要
為了讓數字變小而人為壓低碰撞段的長度或修改判定去符合這次的窗口，這個
指標本來就該反映「玩家撞牆後多快能重新控制」的真實體感。

### 2. `steering-grip`：5.5/5.6 草地/泥地速度懲罰完全沒有量測基礎

```
5.5 grass_speed_penalty  0  窗口 [0.55, 0.70]  FAIL
5.6 dirt_speed_penalty   0  窗口 [0.80, 0.90]  FAIL
```

`feel.py` 的算法已經存在（`frame.get("surface")=="grass"`/`"dirt"` 的
平均速度除以 `"asphalt"` 的平均速度）——**問題不在驗證器，是從來沒有
任何 frame 回報過 `grass`/`dirt`**。`world.ts` 的 `snapshot()` 把
`surface` 寫死成 `'asphalt'`，`TRACK_GEOMETRY` 也只有單一瀝青環，沒有
任何草地／泥地區域存在。

這輪要讓這兩個指標有真實數字，不是繼續跳過。一個可能的最小做法（不是
指令）：不改變現有的牆面碰撞邊界（`INNER_COLLISION_RADIUS`/
`OUTER_COLLISION_RADIUS` 維持原樣，賽道視覺跟牆的位置都不用動——W3
才處理視覺，這輪純粹是物理／telemetry），在現有賽道寬度內把徑向分成
幾個帶：例如內側靠近 apex 的一小段算 `dirt`、外側靠近牆的一小段算
`grass`、中間維持 `asphalt`，`#stepDrive()` 依 `surface` 套用對應的
速度懲罰係數（目標窗口就是懲罰係數該落的範圍）。這樣不需要新增碰撞
幾何，也不會跟渲染器（賽道視覺、牆的位置）產生不同步的風險。你如果有
更好的做法（例如賽道某個角度區間整段是 dirt shortcut）也可以，怎麼做
你決定。

跟其他 §5/§6/§7/§8 的 probe 一樣，需要一個專用的 deterministic probe
（刻意把車開到草地／泥地區域量測速度比），不要指望主 `lap-a` fixture
剛好經過——它目前應該全程都在賽道中線附近，不會自然產生 grass/dirt
frame。

---

## 完成的定義

- [ ] `6.5` 落在 `[0, 3]`（若量測面調整後仍調不進窗口，如實記錄實際
      數字與已嘗試的方向）
- [ ] `5.5` 落在 `[0.55, 0.70]`，`5.6` 落在 `[0.80, 0.90]`，皆由真實
      surface telemetry 算出，不是預設值或硬編碼
- [ ] `4.5`（硬門檻）與既有的 `7.3`/`7.4`/`8.2`/`8.4`/§2/§3/§4 其餘/
      §6.1-6.4/§7 其餘/§8 其餘不退化
- [ ] ghost-replay 三次仍 byte-identical
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `pytest` 全數通過
- [ ] 新的 `loop/round-13/VERDICT.json`，schema 驗證通過
- [ ] `loop/budget.json` 的 `collision-response.spent`／
      `steering-grip.spent` 更新為這輪實際花費（在原本的數字上累加）；
      **如果這輪同時處理兩個元件，花費請拆分記錄成兩個各自的數字，
      不要把同一個總數逐字寫進兩個 ledger**——R12 這樣做讓我沒辦法
      判斷是真的各花那麼多還是重複計入，這次麻煩說清楚
- [ ] **收尾前自己跑一次 `loop/README.md` 的 merge-base 檢查**，確認
      `feat/physics` 的所有 commit 真的在 `main` 的祖先鏈裡

## 這輪不做什麼

- 不動賽道視覺、牆的位置——渲染器（我的範圍）跟這輪無關
- 不做 AI 決策邏輯／per-character 調校
- 不重新診斷 6.5/5.5/5.6 的根因——BACKLOG 已經查清楚了，這輪是處理

## 實作方式由你決定

`wall_stick_frames` 走量測面還是物理面、grass/dirt 的幾何怎麼分布、
懲罰係數怎麼調到窗口內——都你決定。
