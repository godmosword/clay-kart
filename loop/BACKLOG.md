# BACKLOG — 撞預算上限而未解決的落差

> 兩種東西寫進這裡：
> 1. 元件撞到 `budget.json` 的 cap 但未達 bar，剩餘落差
> 2. Cursor 遇到需要判斷的任務（LOOP-OPS §4.4），停下來寫在這裡
>
> Lead 定期裁決。Agent 不得自行從此清單取項目來做。

---

## 格式

```markdown
### {element} — {簡述}
- **輪次**：R{N}
- **現況**：{指標} = {實際值}
- **目標**：{窗口}
- **已嘗試**：{方向一}、{方向二}
- **來源**：{工具}
- **狀態**：待裁決 | 已排入 R{N} | 放棄
```

---

## R12 已處理

### airborne-landing + input-feedback — R12 兩個舊缺口已完成
- **輪次**：R12
- **現況**：7.3 `landing_speed_retention=1.0` PASS；7.4 `hard_landing_retention=0.7645012039` PASS；8.2 `input_buffer_window_ms=91.6666667` PASS；8.4 `steer_deadzone=0.08` PASS。
- **回歸**：4.5 `car_lengths_gained_tier2=1.5191494913` PASS；§5 全掃描除既有 5.5/5.6 外無回歸；既有 4.4/4.6/4.7/4.10/6.5 仍留待後續裁決。
- **實作**：physics commit `c8c5265`；落地角度耦合水平減速、同 tick 引擎增速不計入 retention、100ms drift press buffer、0.08 steer deadzone。
- **驗證**：R12 artifact/verdict、typecheck、build、W1、pytest 11/11、ghost 三次 byte-identical。
- **預算**：本輪最終實際 417744，已在 `budget.json` 的 airborne-landing 與 input-feedback 原 spent 上累加。R9 的 1135659 只核對到歷史 VERDICT/budget，沒有獨立可重建的 token 拆分證據，未改寫。**待釐清**：417744 這個數字被逐字加進了兩個元件（不是拆分成兩份），若這是同一輪合併工作的總花費，兩個 ledger 都加整數會造成帳面上重複計入；若這輪對兩個元件真的是各自獨立花費 417744（例如分開起了兩個 context），則各自記錄是對的。目前無法從 repo 內獨立判斷，下輪跟 Codex 確認。
- **Lead 獨立驗證（已完成）**：在 `ck-physics` worktree 對 `c8c5265` 重跑
  typecheck/build/pytest 11/11 全 PASS；ghost-replay 三次重新產生位元級
  相同；乾淨重新產生的 telemetry 餵 `feel.py` 獨立算出 42 項 checks，
  跟已提交 VERDICT.json 逐項零差異。主 gameplay fixture（`lap-a`）的
  7200 frames／398 events 跟 R11 逐位元完全相同——這輪新增的落地／輸入
  行為完全沒有觸及主 fixture，只影響專用 probe，回歸風險等於零。
  7.3=1.0 是 `landingHorizontalRetention()` 在 `smoothBlend` 飽和到 1
  時的理論上限，跟 `ghost-replay.mjs` 新增的 `Math.min(1, ...)` 量測
  上限剛好重合，不是巧合湊數——完全符合 R9 當時的預測（「理想情況下
  落地不扣速，這條本來就該貼著上限」）。8.2=91.6666667ms 是掃過
  1–24 tick 提前量找到的實際邊界（非硬編碼常數 100ms），邊界效應
  本身就是有機測出來的證據。
- **設計細節值得注意（非阻斷）**：drift 緩衝的狀態機讓「按一下就放開」
  的提前輸入只在條件滿足後獲得恰好一個 tick 的 charging 才被取消
  （因為放開後 `driftBufferedActivation` 只提供一幀寬限），`driftTier`
  永遠來不及離開 0，所以純粹的「點一下」不會真的讓玩家漂移成功，只是
  讓 `drift_start` 事件如實觸發、滿足 `8.2` 的量測定義。這是否符合
  預期的玩家體感（緩衝是否該讓輸入撐到條件滿足後繼續正常累積）待實際
  試玩後再判斷，記錄於此避免之後重新診斷同一行為時要重查一次。
- **狀態**：已完成並驗證，`c8c5265` 已由 Lead 合併進 main（merge commit
  `b4b5233`）。這是同一類「程式碼漏併入 main」疏漏第五次發生（前四次：
  physics×2、visual、plumb），機制持續有效但不保證不再發生。

## R13 已處理

### collision-response + steering-grip — R13 兩個舊缺口已完成
- **輪次**：R13
- **現況**：6.5 `wall_stick_frames=2` PASS；5.5 `grass_speed_penalty=0.6435420429` PASS；5.6 `dirt_speed_penalty=0.8794263055` PASS。
- **實作**：physics commit `112ff16`。6.5 使用「collision impulse 且地面速度 < 10% BASE_TOP_SPEED（2.4 u/s）」的量測定義；surface 在既有環形 lane 的下半圈加入短角度 dirt/grass sectors，未改牆 collider，並由 deterministic surface probe 提供 raw target frames 與 settled asphalt reference。
- **回歸**：主 fixture 7200 frames 全為 asphalt；§2/§3/§4、4.5、5.2/5.7/5.8/5.9、6.1–6.4、7/8 全部維持 R12 數值。整體 feel 仍只保留既有 backlog FAIL（最大 4.4）。
- **Lead 獨立驗證（已完成）**：在 `ck-physics` worktree 對 `112ff16` 重跑
  typecheck/build/pytest 13/13 全 PASS；ghost-replay 三次重新產生位元級
  相同；乾淨重新產生的 telemetry 餵 `feel.py` 獨立算出 42 項 checks，
  跟已提交 VERDICT.json 逐項零差異，包含 6.5=2.0、5.5=0.6435420428806979、
  5.6=0.8794263054903919、4.5=1.5191494912896797（不退化）；既有的
  4.4/4.6/4.7/4.10 FAIL 維持不變，跟這輪範圍無關。主 fixture 的 frame
  數值有 ULP 級（~1e-14）浮點差異——追查是新增的速度上限安全鉗制在
  柏油路頂速門檻附近偶爾因浮點精度觸發極微小縮放，不是行為變化，
  `max_penetration_depth` 仍是 1e-14 量級，determinism 本身在重複執行
  間保持 100% byte-identical，不影響任何 BAR-FEEL 窗口。
- **預算拆分**：R13 最終總用量 200786；collision-response `40157`（20%，
  stuck threshold/telemetry/test scope）、steering-grip `160629`（80%，
  surface world/probe/validator/test scope），兩數相加才是本輪總花費，
  未重複灌入 ledger——這次正確回應了 R12 收尾時提出的要求。
- **狀態**：已完成並驗證，`112ff16` 已由 Lead 合併進 main（merge commit
  `5036a46`）。這輪 Codex 正確地沒有嘗試自己合併，只回報 blocked 等
  Lead 收尾——這正是 R2 之後建立的分工設計本身，不是疏漏，記錄於此
  更新前幾輪「第N次同一疏漏」的框架：只要 Lead 每輪都跑 merge-base
  檢查並在收尾時完成合併，這個手動交接步驟就是正常流程的一部分，
  不代表協作出了問題。

## R15 已完成（12.4 真正 PASS，已獨立驗證並合併）

### ai-opponents — R15 修正橡皮筋機制，12.4 從誠實 FAIL 變成真正 PASS
- **輪次**：R15
- **Lead 獨立驗證（已完成）**：`ck-physics` worktree 對 `bddf6ce` 重跑
  typecheck/build/pytest 14/14 全 PASS；ghost-replay 三次重新產生位元級
  相同；乾淨重新產生的 telemetry 餵 `feel.py` 獨立算出 46 項 checks，
  跟已提交 VERDICT.json 逐項零差異。確認 `tools/validate/feel.py` 這輪
  沒被改動，`12.4` 仍讀 `observed_max_speed_ratio`，沒有走回 R14 第一版
  用配置值頂替的老路——從自己重新產生的 telemetry 原始 probe 資料直接
  核實 `observed_max_speed_ratio=1.0032181019026873`，非信任 artifact。
- **修法**：`src/ai/controller.ts` 把 `targetRatio` 的 `gapFactor` 混合
  改成 `gapFactor^0.33`（`RUBBERBAND_TARGET_RESPONSE_EXPONENT`）的次
  線性響應曲線——R14 的根因猜測（追趕目標隨即時 gap 立刻自我衰減）
  被 Codex 用實際 trace 資料證實（tick 301：舊版 target 已掉到
  `0.9714`，新版維持在 `1.0319`），修法讓目標在 gap 還沒完全 closed
  前維持較高，`gapFactor=0` 時仍正確收斂回 base target，無 NaN/邊界
  問題。
- **副作用（已檢查，非造假）**：`12.3` 從 `3.4833333333333343` 變成
  `3.0166666666666675`，margin 明顯變薄（只高於窗口下限 `3.0` 約
  `0.0167s`）。機制上可解釋：`difficulty-spread` probe 的 player 是
  靜止參照，兩個難度的 AI 靠近該參照時都會獲得一些橡皮筋加速，相對
  縮小彼此的圈速差——這正是 R15 任務裡明確要求檢查的交互作用，Codex
  確實檢查並如實回報，兩個數字都從真實模擬推導。**margin 變薄記入
  觀察，若之後再調整 rubberband/difficulty 相關參數，`12.3` 有可能
  被連帶推出窗口，優先檢查這項**。
- **實作**：physics commit `bddf6ce`。
- **預算**：R15 本輪實際 253052，`ai-opponents` 累加至 972995（cap
  300000，已達 3.2 倍，超支如實記錄，符合 W2 一貫政策）。
- **狀態**：已完成並驗證，`bddf6ce` 已由 Lead 合併進 main（merge
  commit `b28bd25`）。`ai-opponents` 元件的四項 §12 行為指標
  （`12.1`-`12.4`）現在全數真實 PASS。

## R14 已完成（12.4 修正版已獨立驗證並合併）

### ai-opponents — R14 真正 AI 駕駛決策：架構與 12.1-12.3 收下，12.4 誠實 FAIL
- **輪次**：R14
- **Lead 獨立驗證（已完成）**：`ck-physics` worktree 對 `17cf3ca` 重跑
  typecheck/build/pytest 14/14 全 PASS；ghost-replay 兩次重新產生位元級
  相同；乾淨重新產生的 telemetry 餵 `feel.py` 獨立算出 46 項 checks，
  跟已提交 VERDICT.json 逐項零差異；玩家車既有 45 項指標零回歸，
  `6.4`（kart-kart 對稱性）在 AI 車真的會動之後仍 PASS。
- **收下**：架構做得紮實——`src/ai/controller.ts` 的 `decideAiInput()`
  是乾淨純函式（無 `Math.random()`、無隱藏狀態），AI 決策透過
  `Kart.setInput()` 走跟玩家相同的 `#stepDrive()`/`#stepYaw()`，沒有
  開特權捷徑。`12.1 ai_lap_completion=true`、`12.2
  ai_overtake_time_s=3.6333333333`、`12.3
  difficulty_lap_time_spread_s=3.4833333333` 三項都是從實際模擬位置／
  圈速推導出來的真數字，獨立重跑驗證無誤。
- **退回**：`12.4 rubberband_speed_bonus_ratio` 回報 `1.1` PASS，但這是
  `decideAiInput()` 算出的**配置常數**（`AI_RUBBERBAND_MAX_RATIO`），
  不是模擬真的測到的東西。`tools/validate/feel.py` 的 `_ai_metrics()`
  對這項明確寫了 comment 解釋為何選擇 `configured_max_speed_ratio` 而非
  `observed_max_speed_ratio`（「避免瞬態加速樣本低估設計上限」），但
  Lead 重新產生的 telemetry 顯示：`observed_max_speed_ratio=
  0.9626708488607413`（低於窗口下限 1.0），即使
  `max_rubberband_gap=2.5` 已經超過觸發滿額加成所需的
  `RUBBERBAND_FULL_GAP≈2.356`——換句話說，遊戲內部的加成目標確實封頂
  過，但車子的**實際速度**整段 probe 從未超過基礎極速的 96.3%，離
  1.1 倍還差得遠。這是本專案從 R4/R7/R9/R10 就在抓的同一類問題（用
  看起來合理的替代值取代真正的模擬量測），差別是這次不是預設值巧合，
  是刻意在程式碼 comment 裡寫明理由的替換。已在 `loop/round-14/
  TASK.md` 加上審查段落退回，要求改讀 `observed`，若因此合法 FAIL
  也照實記錄，不要為了通過再想別的替代值。
- **修正版（commit `326283f`）**：`_ai_metrics()` 改為只讀
  `observed_max_speed_ratio`，不再有 `configured` 分支頂替。Lead 獨立
  驗證：`ck-physics` worktree 對 `326283f` 重跑 typecheck/build/pytest
  14/14 全 PASS，ghost-replay 三次重新產生位元級相同，乾淨重新產生的
  telemetry 餵 `feel.py` 獨立算出 46 項 checks 跟已提交 VERDICT.json
  逐項零差異，`12.4=0.9626708488607413` 誠實 FAIL（`priority_rank=10`
  最低，不影響 `largest_gap` 仍為既有 `4.4`），`12.1`-`12.3` 與其餘
  45 項玩家車指標維持不變。
- **12.4 FAIL 根因（Lead 分析）**：`max_rubberband_gap=2.5` 已超過
  `RUBBERBAND_FULL_GAP≈2.356`，代表 AI 的目標速度確實一度封頂在
  `1.1x`，但實際車速從未追上。合理推測：`decideAiInput()` 的
  `progressGap` 是即時值，AI 一旦開始加速追近，gap 本身就開始縮小，
  `gapFactor`／`targetRatio` 跟著往下掉——加成目標可能在車子還沒真的
  加速上去之前就已經自我衰減，形成一個負回饋。這是設計/調校問題，不是
  測量造假，比照 `5.5`/`5.6`/`6.5`/`7.3`/`7.4` 的先例：先誠實記錄
  FAIL，列入 BACKLOG，之後再決定是調窗口（例如降低下限承認合理的
  漸進式追趕，而非要求真的超過基礎極速）還是調機制（例如把加成套用在
  加速度而非純粹目標速度上，讓追趕的過程本身更快）。
- **實作**：physics commit `17cf3ca`＋修正 `326283f`（前一實作 commit
  `9c6e7dc`）。
- **預算**：Codex 回報本輪實際 420990，`ai-opponents` 累加至
  719943；修正版本身只改了驗證邏輯，未產生額外物理改動，此數字視為
  R14 整體花費，不再重新拆分。
- **狀態**：已完成並驗證，`326283f` 已由 Lead 合併進 main（merge
  commit `c935d31`）。`12.4` 的視窗/機制調整留待後續裁決，不阻擋
  `ai-opponents` 元件本身視為已交付第一版真實 AI 決策。

## 待裁決

### 轉向在畫面上是反的 —— 按 → 車子往左轉

- **輪次**：R20（接線時發現）
- **現況**：`src/ui/player-input.ts` 把 `ArrowRight`／`KeyD` 對到 `steer = +1`；
  `src/physics/world.ts` 的 `yawRate = steeringInput * MAX_STEER_YAW_RATE * …`
  讓正的 steer 增加 yaw；而專案慣例 `forward = (sin yaw, cos yaw)`，yaw 增加
  等於車頭從 `+Z` 轉向 `+X`。追尾相機沿 `+forward` 看出去時，**`+X` 在畫面
  左側**（相機 local X = `(-fz, 0, fx)`，yaw=0 時等於 `(-1,0,0)`）。
  所以：**按 → 車子往畫面左邊轉，按 ← 往右邊轉。**
- **證據（兩條獨立路徑，都不是靠讀 code 推的）**：
  1. headless 模擬：`steer=+1` 持續 0.33s 後 `yaw 0 → 0.667`、
     `vel = (+8.81, 0, +15.05)`，車確實往 `+X` 走
  2. 實機截圖：`loop/round-20/artifacts/shots/game-hold-right.png`（按住 →）
     車偏向**外側**護欄；`game-hold-left.png`（按住 ←）車偏向**內側**護欄。
     賽道圓心在起點的 `-X` 方向，所以要跟著彎道走必須往 `-X` 轉 —— 也就是
     必須按 ←。兩張圖是同一個 build、同樣的秒數，只有按鍵不同
- **為什麼 W1 沒抓到**：W1 的驗證是「用 CDP 送鍵盤事件、讀模擬內部狀態確認
  轉向真的改變 yaw」——**驗的是 yaw 有沒有變，不是往哪邊變**。這類缺陷只有在
  畫面跟輸入擺在一起看的時候才會現形，而畫面直到 R20 才第一次被拍下來
- **目標**：按 → 車往畫面右邊轉
- **為什麼 Lead 不順手改**：修正點在 `src/physics/world.ts`（Codex）或
  `src/ui/player-input.ts`（Cursor），兩個都不是 Lead 的寫入範圍。而且
  **改物理那邊會動到符號慣例**：`tools/validate/feel.py`、各種 turn radius／
  drift probe 都假設了某個方向，翻符號可能讓 `BAR-FEEL §5`／`§4` 的既有
  PASS 全部要重驗。改輸入那邊（把 `steerRight` 對到 `-1`）不動模擬，代價小
  得多，但那等於承認契約的符號定義在輸入端 —— 這是裁決，不是順手
- **契約缺口（已補）**：`src/contract/sim.ts` 的 `WorldInput.steer` 原本只寫
  「轉向輸入：-1 到 1」，**沒有定義哪邊是右**。兩邊各自實作各自合理，合起來
  就反了
- **裁決：定義釘在 yaw，修正落在輸入層。** 第一版契約寫「`steer > 0` = 畫面
  往右」，讀起來直覺，但那樣會讓 `src/physics/world.ts` **與 `src/ai/controller.ts`
  同時變成違規**——`controller.ts` 的 `steer = clamp(yawError / STEER_ERROR_RANGE)`
  本來就把 steer 當成「要把 yaw 改多少」，翻符號會讓每台 AI 車往目標的反方向
  轉，`BAR-FEEL §12.1`–`§12.4`（R15 全數 PASS）整組垮掉。為了一個比較順口的
  符號約定去動已經通過驗收的模擬，是把成本放錯地方。
  規範定義因此改為 **`steer > 0` 使 yaw 增加**（模擬側語意），畫面上的左右
  由 `src/ui/` 翻譯——那本來就是輸入層存在的理由
- **修正內容**：`src/ui/player-input.ts` 的按鍵對應改用具名常數
  `STEER_SCREEN_LEFT = 1` / `STEER_SCREEN_RIGHT = -1`，並在該處寫明為什麼
  「右 = -1」看起來反了卻是對的。`src/physics/`、`src/ai/` 一行未動
- **驗證**：
  - 實機截圖，同 build 同秒數只有按鍵不同：`shots/game-hold-right-fixed.png`
    （按住 →）車偏**內側**、`shots/game-hold-left-fixed.png`（按住 ←）車偏
    **外側**，正好是修正前兩張的鏡像
  - `BAR-FEEL` 零回歸：`ghost-replay` + `validate/feel.py` 重跑，46 項中 42 項
    PASS，FAIL 的仍是 `4.4`／`4.6`／`4.7`／`4.10` 這四個自 R5 起擱置的 drift
    次要項目，數值與 R15 相同（`VERDICT-feel.json`）。物理沒動，本來就該如此，
    但「本來就該如此」不構成證據，所以還是跑了
- **狀態**：**已修正（R20）**

### driver-face 裝到車上之後笑口看不到

- **輪次**：R20
- **現況**：`driver-face` 是一整塊平板，笑口在眼睛正下方約 0.2 單位；
  `kart-body` 是甲蟲車，前擋之下立刻接一段近乎水平的引擎蓋。剛性組合時
  眼睛擺得好看笑口就沉進引擎蓋，笑口露出來眼睛就得抬到車頂高度
- **已嘗試**：傾角 `-0.25`／`-0.6`／`-0.85` 三檔。`-0.85` 能讓笑口浮出蓋面，
  但變成**朝上**，正面仍然看不到，且臉整個像躺著。目前採用 `-0.6`（眼睛讀
  得最清楚的一檔），笑口不可見
- **為什麼這是缺陷不是取捨**：`CHARACTERS.md §4`「**大圓眼 + 明確笑口**是全
  卡司共通識別」。參考圖 `小紅賽車.jpg` 能同時做到，是因為眼睛在前擋、笑口在
  保險桿，中間隔著一整個引擎蓋的落差 —— 等於臉在參考圖上**不是剛性的一塊**
- **目標**：正前方看得到笑口。方向是把笑口拆成可獨立擺放的部件，或讓臉沿車頭
  曲面貼合，兩者都是元件層級的造型工作
- **來源**：`src/render/components/kart.ts` 檔頭、
  `loop/round-20/artifacts/shots/game-idle.png`
- **狀態**：待裁決 —— 已寫進 `BAR-VISUAL §5.3`（「裝到車上被擋住也算沒做到」），
  下一輪 `driver-face` 處理

### 黏土管線的效能成本：VSM 陰影是主導項

- **輪次**：R20
- **現況**：同機器同 probe 三種設定（artifacts 三份 JSON 可覆核）：

  | 設定 | fps_p50 | frame_time_p99 | draw_calls | triangles_k |
  |---|---|---|---|---|
  | W1 方塊車 | 51.81 | 39.8ms | 5 | 3.3 |
  | 黏土車，關陰影 | 14.01 | 141.0ms | 62 | 41.1 |
  | 黏土車，開 VSM 陰影 | 1.17 | 1680.6ms | 122 | 76.5 |

  材質與幾何本身約 3.7×，**VSM 陰影再 12×**。主導成本是陰影，不是材質
- **量測環境的限制（重要）**：容器內 SwiftShader 軟體算繪，沒有 GPU。
  同一支 probe 在這台機器上量 W1 方塊車只有 51.8fps，R19 在原本的機器上量到
  59.88fps —— **跨機器絕對值不可比，只有同機器相對值可比**。所以「1.17fps」
  不等於「遊戲在目標裝置上是 1.17fps」，但「陰影佔了 12 倍」這個比例是可信的
- **目標**：`BAR-PERF §2` 全項回到窗口內
- **可考慮的方向（不是建議，是紀錄）**：陰影貼圖邊長、`blurSamples`、
  是否改用單一「假接地陰影」貼片取代即時投影。`clay/lighting.ts` 刻意不提供
  逐元件把手，所以任何調整都是全場一起 —— 這正是 `§5.0` 鐵律要的
- **狀態**：待裁決 —— 這是 W3 的第一個真實效能訊號，之後 9 個元件都會加上去，
  越晚處理越貴

### 上游參考圖 阿酷鑽地車.jpg 不是黏土

- **輪次**：R20
- **現況**：`refs/clay/characters/阿酷鑽地車.jpg` 是實體壓鑄/塑膠玩具挖土機的
  照片：金屬油壓桿、光澤表面、印刷上去的臉。`§6` 的 `metallic`、`roughness`、
  「顏色是材質本身」三條全違反
- **影響**：`CHARACTERS.md §2` 把它列為阿酷的角色參考。造型參考可以用，
  **材質參考不行**——W3 之後做阿酷的造型時若直接照著它捏，會做出全場唯一一台
  塑膠車。已在 `BAR-VISUAL §7.1` 明文排除於參考半邊之外
- **這是上游素材本身的瑕疵**，不是我們的判斷問題。要修得回上游重出一張
- **狀態**：待裁決（W3 做到阿酷之前必須有結論）

### Lead 流程觀察：R17 出現「連 commit 都沒做」的新變體
- **輪次**：R17
- **現況**：過去記錄的漏洞（見下方「Lead 流程漏洞」條目）都是「commit
  了但沒併進 main」——程式碼至少留了一個 commit hash 可以追。R17 的
  `ck-plumb` worktree 這次連 commit 都沒做，`tools/visual/`、
  `package.json`/`package-lock.json` 的變更完全是未追蹤的工作目錄
  異動。若這輪沒有用 `git status`／`git log` 交叉核對 worktree 實際
  狀態，只看 Cursor 回報的文字（「完成，未合併功能分支進 main」，但
  沒給 commit hash），很容易誤以為至少有個 commit 存在
- **處置**：Lead 讀過內容確認無誤後代為 commit 並推送、合併，過程中
  排除了 Cursor 自己驗證用的暫存輸出目錄
- **影響**：現有的 `merge-base --is-ancestor` 檢查只能抓「commit 存在但
  沒併入」，抓不到「連 commit 都沒有」——這種情況下該檢查甚至不會
  報錯，因為沒有 commit hash 可以拿去比對，表面上看起來像「這輪什麼
  都沒動」而不是「有東西但沒存」
- **狀態**：已裁決並補上。`loop/README.md` 的收尾檢查新增
  `git status --short` 逐一掃描三個 worktree 這一步，跟既有的
  `merge-base` 檢查並列——後者抓「commit 存在但沒併入」，前者抓
  「連 commit 都沒有」

### contact-sheet pairing — refs/clay 對不齊 BAR-VISUAL 12 元件
- **輪次**：R17
- **現況**：`refs/clay/` 現有素材與 `BAR-VISUAL.md §4` 的 12 個評分元件沒有一對一對應。腳本機制（`tools/visual/contact-sheet.mjs`：12 組並排、種子打亂、左右隨機、`contact-sheet.key.json` 隔離、缺圖 placeholder）已可跑；**配對本身未填**，manifest 裡 12 個 `ref` 皆為 `null`。
- **盤點（refs/clay）**：
  - 場景合成圖 8 張：`car-park.png`（黃金樣本）、`dino.png`、`rescue.png`、`ocean.png`、`sea.png`、`cloud-a.png`、`cloud-b.png`、`cloud-c.png`
  - 角色肖像 6 張：`characters/*.jpg`（含小紅賽車）
  - 以上幾乎都是整場景或角色立繪，不是依元件拆好的 512×512 參考半邊
- **對 12 元件的缺口（Cursor 不自行湊）**：

  | 元件 | 為何不能自行配 |
  |---|---|
  | kart-body / kart-wheels / driver-face | 合成圖裡有車，但是否裁切、裁哪、角色 JPG 能否當 face 參考＝設計判斷 |
  | track-surface / track-barriers / foliage / shadows-contact | 嵌在場景合成圖裡，裁切區域與「元件級參考」是否等價＝設計判斷 |
  | skybox-lighting | `cloud-*` 候選存在，但是否對齊 §5.0 燈光條款＝設計判斷 |
  | water-sea | `sea.png` vs `ocean.png` 用哪張＝設計判斷 |
  | drift-sparks / item-boxes / ui-hud | refs 內無對應素材 |

- **目標**：Lead 裁決每組的參考半邊來源（整圖／裁切座標／暫緩該組／另補參考），再填 `tools/visual/contact-sheet.manifest.json` 的 `ref` 欄位。
- **已嘗試**：無——依 `LOOP-OPS.md §4.4` / R17 TASK，配對判斷停手寫 BACKLOG，不自決湊法。
- **來源**：Cursor R17；`loop/round-17/TASK.md`；`BAR-VISUAL.md §1`/§4；`refs/clay/`
- **Lead 獨立驗證（腳本本身，已完成）**：自己重新執行
  `node tools/visual/contact-sheet.mjs`——同 seed 兩次執行輸出位元級
  相同，不同 seed 輸出不同；PNG 尺寸 2048×3072 正確；用 `sharp` 讀
  metadata 確認沒有 exif/iptc/xmp，沒有 key 檔名或路徑洩漏；manifest
  的 12 個 `ref` 逐一核對皆為 `null`，非造假。**發現這輪的程式碼原本
  完全沒有 commit**（跟過去「commit 了但沒併進 main」不同，這次連
  commit 都沒做，只是 worktree 裡的未追蹤變更）——讀過內容確認無誤後
  由 Lead 代為 commit（`43632a2`）並合併進 main（`6679f55`），過程中
  排除了 Cursor 自己驗證用的 `tmp-a/b/c` 暫存輸出。腳本本身的機制已
  驗證可信，配對判斷仍待裁決，狀態維持不變
- **狀態**：**已裁決（R20）**。10 組配對、2 組暫緩（`item-boxes`／`ui-hud`，
  refs 無可用素材，唯一箱體候選有鏡面反光違反 `§6`）。判準與逐項理由寫進
  `BAR-VISUAL.md §7.1`，座標寫進 `tools/visual/ref-pairing.json`，由新增的
  `tools/visual/ref-tiles.mjs` 算成 512² 正規化半邊（裁切／alpha 壓平／
  放大上限 1.4× 強制，超過直接失敗不交糊圖）。`contact-sheet.mjs` 一行未改——
  共用目錄不代表可以互改。`contact-sheet.manifest.json` 的 `ref` 已填。
  實測：12 格產出正常，已實作的 3 個元件現在是真的 ref↔ours 配對，
  盲測 A/B 對那 3 組可以開跑

### ai-opponents — R11 第一階段多車架構與 kart-kart 碰撞已完成
- **輪次**：R11
- **現況**：`createWorld({ aiOpponents: [...] })` 產生對齊的 `karts[]`/`laps[]`；專用 pair probe 為 2 台車、`playerIndex=0`，6.4 `kart_kart_impulse_symmetry=1.0` PASS。AI 車目前是 deterministic stationary placeholder。
- **目標**：6.4 `[0.92, 1.08]`
- **已嘗試**：等質量、固定恢復係數的動態圓形碰撞；事件層記錄雙方 kart index、對方 index、雙方 impulse 與 symmetry ratio。單車既有 frames/events 逐項維持不變。
- **處置**：R11 只完成架構與碰撞物理；AI 駕駛決策、超車／路線／難度與 per-character 調校依 TASK 明確留待後續分期。
- **來源**：`loop/round-11/artifacts/lap-a.json`、`loop/round-11/VERDICT.json`、physics commit `88c102d`
- **狀態**：後續分期已開工——`BAR-FEEL §12`（AI 對手行為，`12.1`-`12.4`）
  已由 Lead 補進 `BAR-FEEL.md`，`loop/round-14/TASK.md` 已開給 Codex，
  要求 AI 車走 `setInput()` 同一條物理路徑，不做特權捷徑

### input-feedback — 8.2 drift buffer 與 8.4 steer deadzone 尚未實作
- **輪次**：R10
- **現況**：8.1 `input_to_sim_latency_ticks=0` PASS；8.2 `input_buffer_window_ms=0` FAIL；8.3 `throttle_deadzone=0` PASS；8.4 `steer_deadzone=0` FAIL。
- **目標**：8.1 `[0, 1]`、8.2 `[80, 130]` ms、8.3 `[0.0, 0.08]`、8.4 `[0.05, 0.15]`
- **已嘗試**：deterministic latency probe、提前按下後放開的 drift pulse + held reference、throttle 101 點與 steer 201 點 requested/effective sweep；結果均由 probe records 推導，沒有讀缺欄位預設值。
- **處置**：依 R10 TASK，本輪不新增輸入功能；現況的 drift state 沒有 release 後 buffer，`setInput()` 也沒有 steer deadzone。若要達成 8.2/8.4，需另行裁決輸入處理行為與其對既有漂移／轉向指標的影響。
- **來源**：`loop/round-10/artifacts/lap-a.json`、`loop/round-10/VERDICT.json`、physics commit `d43e1a1`
- **Lead 核實**：四個數字剛好都是 0，外觀跟先前的假 PASS 一樣，特別去讀了
  probe 實作與原始資料。`latency_probe` 用獨特測試值 `0.37` 追蹤到
  `request_tick=24`／`applied_tick=25`，真的量出來的。`buffer_probe`
  顯示 `activation_tick=None`（提前放開真的沒觸發）對照
  `held_reference_activation_tick=83`（持續按住的參照組真的觸發），
  證明「沒有緩衝」是真測出來，不是巧合預設。確認不是 R7 之前
  `6.1`–`6.3`／`7.5` 那種假 PASS 的重演
- **狀態**：待裁決——沒有硬門檻卡著，跟前四個元件的收尾模式一致

### airborne-landing — 7.3/7.4 落地速度保留率仍超出窗口
- **輪次**：R9，Lead 拆開原始 probe 資料追出兩個不同根因
- **現況**：smooth `landing_speed_retention=1.0019`、steep
  `hard_landing_retention=0.9607`；7.5 latency `0` 已真量測並 PASS
- **目標**：7.3 `[0.90, 1.00]`、7.4 `[0.70, 0.85]`
- **根因（兩項性質不同）**：
  1. **7.3 略超過上限**：`smooth` probe 全程 `throttle=1`，落地那個
     tick 引擎推力跟 `#stepVertical()` 的 `vy` 歸零同時發生，正常加速度
     混進了落地量測窗口，製造 0.19% 假性增速——量測方法論的邊界效應，
     不是設計問題（理想情況下落地不扣速，這條本來就該貼著上限）
  2. **7.4 幾乎不比 7.3 差，是真正的物理缺口**：落地時只有 `vy` 歸零，
     `vx`/`vz` 完全不受影響。現行模型裡「落地衝擊角度」跟「水平速度
     損失」之間**沒有任何耦合機制**，不管落地多陡，水平速度都不會被
     削減。要讓 7.4 落進窗口需要加入衝擊角度相關的水平減速，類似 R7
     給碰撞角度分段賦予不同反彈係數的做法（`#resolveTrackCollision()`
     的 `grazingBlend`/`wallBounce` 分段邏輯可以參考）
- **處置**：本輪完成真實 landing telemetry，未發明物理上不存在的落地
  分支，也未調整物理常數——正確的紀律。若要讓 7.3/7.4 達標，是下一輪
  物理面的工作，不是量測面的事
- **來源**：`loop/round-9/artifacts/lap-a.json`、`loop/round-9/VERDICT.json`、
  physics commit `2eefb0c`
- **狀態**：待裁決——沒有硬門檻卡著，跟 drift-miniturbo/steering-grip/
  collision-response 的收尾模式一致，可以先擱置轉下一個元件

### airborne-landing 預算數字異常，疑似記錄錯誤
- **輪次**：R9
- **現況**：`loop/budget.json` 記錄 `airborne-landing.spent = 1135659`，
  cap 150000，超支 657%
- **可疑之處**：這輪只改了 `tools/telemetry/`、`tools/validate/`，
  `world.ts` 完全沒動，工作量級跟 R7（collision-response，改動範圍相近，
  花費 149104，首次沒超支）明顯不成比例。目前 W2 累計最高單元件花費是
  `steering-grip` 三輪 625276——`airborne-landing` 一輪就報 1135659，
  接近前者的兩倍
- **狀態**：待裁決——懷疑是筆誤或單位算錯（例如把某個中間值誤乘了
  一個數量級），已 merge 但不因此調整 cap 或改變預算重估的判斷基準，
  下輪跟 Codex 確認

### collision-response — 6.5 持續貼牆滑行仍被計為 wall stick
- **輪次**：R7
- **現況**：`wall_stick_frames=289`，目標 `[0, 3]`；主 replay 的碰撞段約 291 tick，速度大多仍在移動，末段才降到低速。
- **已嘗試**：將 `collisionImpulse` 的純位置修正與真正速度衝量分離；6.5 由 291 降至 289，但持續向牆施壓的滑行仍形成長碰撞段。
- **根因判斷**：現行單車環形 collider 沒有獨立的 wall-contact/sliding state，validator 只能從碰撞衝量連段判定，會把高速擦牆與卡牆混在一起；需後續決定接觸狀態或更精確的 stuck 定義。
- **來源**：`src/physics/world.ts`、`loop/round-7/VERDICT.json`
- **狀態**：待裁決

### collision-response — 6.4 車對車衝量對稱性不可測
- **輪次**：R7
- **現況**：`kart_kart_impulse_symmetry=0`；`SimSnapshot.kart` 只有單車，ghost replay 沒有第二台車。
- **處置**：本輪不以單車虛構對稱性數字；延後至 `ai-opponents` 多車架構落地後再測。
- **來源**：R7 artifact meta `kart_kart_collision_coverage`、既有「SimSnapshot 目前只支援單車」條目
- **狀態**：待裁決

### steering-grip — §5.5/5.6 缺少可測的草地／泥地表面
- **輪次**：R6
- **現況**：`src/physics/world.ts` 的 `snapshot()` 將 surface 固定為 `asphalt`，現行 `TRACK_GEOMETRY` 只有單一瀝青環；feel 實測 `grass_speed_penalty=0`、`dirt_speed_penalty=0`。
- **目標**：5.5 `[0.55, 0.70]`、5.6 `[0.80, 0.90]`
- **處置**：本輪跳過，不虛構不存在的草地／泥地幾何；需之後的賽道內容與 surface 區域落地後再測，物理層再套用速度懲罰。
- **來源**：`loop/round-6/VERDICT.json`、`src/physics/world.ts`
- **狀態**：待裁決

### W2 的 budget.json cap 系統性低估，需整體重估
- **輪次**：R6 收尾發現
- **現況**：W2 目前完成的兩個元件都大幅超支——`drift-miniturbo` 花
  626134（cap 400000，+56%），`steering-grip` 花 625276（cap 250000，
  +150%）。兩者的**絕對**超支金額相近（+226134、+375276），不是單一
  元件估算錯，是 bootstrap 時整組 cap 估算的方法就偏低
- **影響**：`collision-response`（cap 200000）、`airborne-landing`
  （150000）、`input-feedback`（100000）、`ai-opponents`（300000）
  很可能也會用同樣的幅度超支。繼續要求 builder「控制在 cap 內」
  沒有意義，只會逼它們在還沒達標時就喊停
- **處置**：R7 起先不對 builder 要求控制在 cap 內，如實記錄 token 用量。
  等 W2 全部元件跑完一輪，用實際花費重新估算 W3 的 cap（W3 用 Opus +
  ultracode，單位成本又跟 W2 不同，不能直接套 W2 的超支比例）
- **狀態**：待裁決——是否要現在就把剩餘 W2 元件的 cap 統一調高，
  或等真的撞到再說

### 外部提案「BAR-FEEL v2」——駁回整份，只採納一項（5.7/5.8/5.9）
- **輪次**：R6 開工前
- **收到的內容**：一份格式完整、論證詳細的文件，主張整份改寫 `BAR-FEEL §4/§5`
  （重新編號成 4.1–4.30、5.1–5.17）、新增 §12「模型形狀約束」、並依 §12.2
  的結構性論證要求把 `steering-grip` 排到 `drift-miniturbo` 前面、預算
  互換（250k↔400k 變 350k↔300k）
- **核實過程（兩個可查證的具體數字宣稱，兩個都查了）**：
  1. **§0.1 主張**：現行 `4.5` 基準線定義（釋放後量 2 秒位移差）「無論怎麼調
     boost 都出不來，遠在窗口外」——**直接被推翻**。R4/R5 兩輪、三次獨立
     process，`4.5` 用現行定義穩定量出 `1.5156`，在窗口內，真實雙跑基準線
     比對（非湊數字，已讀過 `ghost-replay.mjs` 實作核實）。文件的推導假設
     boost 只調極速上限、不影響加速度，但 Codex 實際做法是直接對位置施加
     脈衝位移，繞開了文件假設的整個問題
  2. **§5B 主張**：現行 `min_turn_radius_u` 在 4/8/12/17 u/s 下實測
     `8.78/8.84/8.87/8.89`（幾乎恆定）——**具體數字錯誤，差了約 2.6 倍**。
     Lead 用乾淨方法重測（全程滿舵、油門催到極速後放開自然減速，全速度區間
     取樣）：實測半徑穩定在 `22.6–22.9`，不是 `8.78–8.89`。**但「半徑幾乎
     跟速度無關」這個定性診斷本身是對的**，Lead 獨立驗證得到同樣結論，
     只是文件引用的具體數字不是從現行程式碼跑出來的
- **結論**：兩個可查證的宣稱，一個被工作中的程式碼直接推翻，一個具體數字
  錯了 2.6 倍。研判這份文件是從 Kinoko 參考模型或理論推演寫成，**沒有實際
  跑過 clay-kart 現行程式碼核對**。文件裡其他大量沒有逐一驗證的精確窗口
  （`§4A`–`§4E`、`§5A`–`§5D` 幾十項）因此也不予信任
- **採納**：只有「轉彎半徑該對速度做三點檢查 + 單調性」這一項——因為 Lead
  獨立驗證過其定性診斷為真。已改寫 `BAR-FEEL §5`（新增 `5.7`/`5.8`/`5.9`，
  `5.2` 更名為 `turn_radius_at_95pct_u`，窗口不變），並提示 `loop/round-6/
  TASK.md` 一個可能的技術方向（轉向輸入端加一階低通濾波），標明為建議
  不是指令
- **未採納**：`§4` 全部重新定義與編號（`4.5` 現行定義已驗證可行，沒有
  非改不可的理由）、`§12.2`（車頭朝向/行進方向分離，做真實漂移視覺角度
  才需要，現行 `4.5` 不需要它就已通過，留給 W3 有視覺需求時再議）、
  `§13` 施工順序與預算調整（前提是「drift 做不出來」，已被推翻，
  順序調整的理由不成立）
- **狀態**：已裁決，不採納整份，只有上述一項已落地。記錄於此避免這份
  文件的其他部分被重新提出時要重查一次

### drift-miniturbo 收尾：4.5/4.9 達標，轉 steering-grip，剩餘項目擱置
- **輪次**：R5 收尾決定
- **現況**：預算花了 626134，cap 400000，超支 56%。硬門檻 `4.5` 從 R4 起
  穩定通過（1.5156，margin 仍薄，1.56%），`4.9` 這輪修好（1.4567 PASS）
- **仍未解決，記錄清楚以免之後重查**：
  - `4.4`/`4.6`/`4.7`：fixture 只測了單一 tier2 釋放路徑（drift 只連續
    充能 3.0s，未達 tier3 門檻 3.5s，也沒測過提早在 tier1 放開），三項
    `actual=0`。很可能是覆蓋率問題不是物理問題，但**沒有實測驗證過這個
    假設**——只是類比 R3 的 §3.5 fixture 缺口模式
  - `4.10`：R5 已從硬編碼改成真量測，誠實回報 FAIL（1.0073，高於窗口
    上限 0.97）。**根因已查清**：`DRIFT_SPEED_RETENTION` 只在進入漂移
    瞬間扣一次速度（one-shot），後續充能期間持續加速會在很短時間內
    把那次扣減吃掉，整段平均測不太到損耗。要讓這項 PASS 需要物理面
    加入「漂移中持續的側向摩擦/速度上限」機制，不是量測面的事
- **決定**：`4.5`（唯一硬門檻）已達標，不再適用 `BAR-FEEL §4.5` 的
  「不適用預算型停止」例外。轉向 `steering-grip`（元件 #4，`loop/round-6/
  TASK.md`）。上述剩餘項目留在這裡，不強制這輪解決
- **狀態**：待裁決——若之後要回頭補 4.4/4.6/4.7/4.10，需要先跟這裡的
  budget.json 加碼一起裁決，不要無聲把 cap 往上調

### drift-miniturbo 暫不進 FROZEN.md
- **輪次**：R4，R5 後重新確認仍成立
- **現況**：`feel-validator` 整體仍 FAIL（largest_gap 現為 `4.4`）。
  `world.ts` 還缺 `4.10` 需要的持續速度損耗機制，之後回頭補時勢必要動
  這個檔案，現在凍結只會擋到自己
- **狀態**：待 `4.4`/`4.6`/`4.7`/`4.10` 有實際進展後再評估

### ~~fixtures/lap-a.json 沒有 reverse 區段，§3.5 恆為 FAIL~~ — 已解決
- **輪次**：R3 發現，R4 修正
- **處置**：Codex 在 R4 加了 reverse 區段，`reverse_top_speed_ratio` 現為
  `0.3999`，PASS

### ~~7.1／4.9／4.10（硬編碼）三項驗證器問題~~ — 已解決
- **輪次**：R4 發現，R5 修正
- **處置**：`7.1` 恢復 PASS（fixture 跳躍時段補回轉向輸入）；`4.9` 改為
  只採主動轉向幀計算，1.4567 PASS；`4.10` 改為從 `driftReplays`/`baseline`
  的真實 frames 算速度比，不再硬編碼——現在誠實回報 FAIL，見上方新條目

### perf-probe.mjs 的 §4 防抽格檢查是寫死常數，永遠通過
- **輪次**：R3 審查發現
- **現況**：`character_anim_hz`／`vehicle_transform_hz`／`camera_hz` 三個值
  在 `perf-probe.mjs` 裡直接寫死（12/60/60），從未載入或量測 `src/render/`
  的任何東西。`fps_p50`／`fps_p05` 量的是 Node 純物理 tick 吞吐量
  （實測 77 萬～120 萬），跟瀏覽器渲染幀率無關
- **目標**：`BAR-PERF §4`——這是全份文件裡少數標明「違反即整輪 FAIL，
  不論其他指標多好」的檢查，優先序還排第一
- **落差**：現在的驗證器結構性地抓不到真的抽格回歸。W3 若不小心把整個
  scene 抽格（`CHARACTERS.md §3` 點名的最容易犯的錯），這三個檢查會
  照樣回報 PASS，因為它們從來沒有真的在看渲染器
- **不是阻斷項**：不擋 W2——W2 沒有渲染改動。但**必須在 W3 視覺 builder
  開工前解決**，否則 §4 這道防線形同虛設。需要真的跑瀏覽器（Playwright
  headless 或類似方案）量測，Node-only 的 proxy 做不到這件事
- **修復（commit `c540b0f`）**：改用真實 headless Chrome（raw CDP，未
  新增 npm 依賴）——`Page.addScriptToEvaluateOnNewDocument` 在 app
  程式碼執行前注入 `requestAnimationFrame`／WebGL `drawElements`/
  `drawArrays` 監聽，完全不需要碰 `src/render/`／`src/loader/`（尊重
  寫入範圍）。`character_anim_hz` 誠實回報 `null` 搭配
  `character_anim_status: 'not_applicable_no_character_animation'`，
  `perf.py` 只在這個明確條件下跳過 `4.1`，其餘任何缺值仍正規化成
  `0.0` 照樣判 FAIL——`test_perf.py` 額外測了「缺 status 欄位不能悄悄
  變 PASS」這個邊界情況，確認沒有留後門。
- **Lead 獨立驗證（已完成）**：`ck-physics` worktree 對 `c540b0f` 重跑
  typecheck/build/pytest 17/17 全 PASS。自己用真實 Chrome 重新跑一次
  `perf-probe.mjs`（非信任 artifact）：`vehicle_transform_hz`/
  `camera_hz`≈60.13（Codex 60.18）、`fps_p50=59.88023956370228`（跟
  Codex 完全一致）、`fps_p05=58.55`（Codex 55.25，時間性指標本來就會
  因真實瀏覽器時序抖動略有差異）；跟時間無關的指標
  （`initial_bundle_kb_gz=132.3505859375`、`triangles_k=3.278`、
  `draw_calls=5.0`）逐位元完全相同——這種「決定性指標吻合、時間性指標
  相近但不同」的模式正是真實瀏覽器量測該有的樣子，不是猜出來的。
  `4.1` 在 checks 裡完全省略，不是假 PASS。整體 VERDICT 16 項 PASS，
  跟自己重新測出的結果逐項對得上。
- **殘留缺口（非本輪範圍，另開新條目追蹤）**：`gc_pause_max_ms`／
  `texture_memory_mb` 仍是 `null`，被 `_finite()` 正規化成 `0.0`
  剛好落在窗口內——這是 R16 之前就存在的行為，R16 沒有讓它變壞，但
  也還沒真的測到，記入下方新條目
- **狀態**：已完成並驗證，`c540b0f` 已由 Lead 合併進 main（merge
  commit `7046b34`）。`BAR-PERF §4` 這道優先序最高的防線現在是真的了

### perf-probe.mjs 的 gc_pause_max_ms／texture_memory_mb 仍未真的量測
- **輪次**：R16 發現，隨 §4 修復一起浮現
- **現況**：兩者在 `perf-probe.mjs` 裡回傳 `null`（誠實標記未量測），
  但 `perf.py` 的 `_finite()` 對非 `character_anim_hz` 的缺值一律
  正規化成 `0.0`，`2.5`／`5.5` 的窗口都含 0，於是「沒測」跟「测到
  數值 0」在 VERDICT 裡看起來一樣，都顯示 PASS
- **目標**：`BAR-PERF §2.5`（GC 暫停）、`§5.5`（材質記憶體）
- **影響**：不算造假（跟 R16 修的問題性質不同，這是既有的 `_finite()`
  行為，R16 沒有新增或加劇），但這兩項目前形同虛設，跟 R3 到 R16 之間
  `§4` 的狀態類似——只是優先序較低（`§6` 排序 2.5 是第 4 順位、5.5
  是最低順位），不像 `§4` 是「違反即整輪 FAIL」
- **狀態**：待裁決，不阻擋 W3 開工，記錄下來避免之後又當成新發現重查
  一次

### Lead 流程漏洞：builder 完工後沒有立刻併回 main（第二次發生）
- **輪次**：R2 收尾審查
- **現況**：這是同一個錯犯第二次。第一次是 Codex 的 R1/R2 物理程式碼，
  第二次是 Claude Code 的 R2 渲染程式碼（賽道/相機/HUD）——兩次都只更新了
  `progress/*.json`，實際程式碼從沒真的 merge 進 `main`。第二次是在用
  CDP 對 Cursor 的輸入接線做真實驗證時發現的：DOM 裡完全沒有 HUD div，
  因為 `ck-plumb`／`ck-physics` 讀到的 `renderer.ts` 還是最初的 stub
- **影響**：不只是「資訊沒同步」——這代表任何工具在自己分支上驗證通過的東西，
  換到別的 worktree 就可能是假的，因為那個 worktree 根本沒有那份程式碼
- **根因**：`loop/README.md` 寫了「協調狀態寫在 main」的規則，但沒寫
  「程式碼也要進 main，不能只靠工具自己 push 到自己的分支」。
  Lead 每輪結束沒有一個固定動作去檢查這件事
- **處置**：兩次的漏洞都已補上（physics 併入於 f8aee33，visual 併入於 4b2a0c9）。
  **這條本身不算解決**——需要一個不依賴「Lead 記得」的機制，否則會有第三次
- **處置（後續）**：已寫進 `loop/README.md` 一個 `git merge-base --is-ancestor` 檢查指令，
  每輪收尾前跑。**第一次實際使用就抓到第三次同一疏漏**（`feat/plumb` 的輸入接線
  也還沒併進 main）——證明這是機制而非我這輪剛好想起來，已修正並重新驗證同步
- **第四次發生（R11）**：Codex 回報「Physics commit：88c102d / Main commit：51685cc」，
  聽起來像兩邊都同步了，但 `51685cc` 只含 `loop/BACKLOG.md`/`budget.json`/
  `VERDICT.json`/artifact/`progress/physics.json` 這些紀錄檔——實際程式碼
  （`88c102d`：`world.ts` 單車轉多車、kart-kart 碰撞、telemetry 消費端更新）
  只在 `feat/physics`，從未進 `main`。跑 `merge-base --is-ancestor` 立刻抓到，
  `npm run typecheck` 當場證實 main 是壞的（`src/contract/sim.ts` 要求
  `karts[]`，`world.ts` 還是舊版單車）。獨立重跑過 `88c102d` 本身（typecheck/
  build/pytest 全 PASS、ghost-replay 三次重新產生位元級相同、乾淨重新產生
  的 telemetry 餵 `feel.py` 跟已提交 VERDICT.json 逐項零差異）確認程式碼本身
  沒問題，純粹是這次的 merge 步驟被跳過，已手動補上（merge commit `66b4ff3`）
- **狀態**：機制本身持續有效（兩次實際使用、兩次抓到），**但沒有阻止問題
  發生**，只保證會被發現。是否要把「push 到 main」直接寫進 builder 每輪
  TASK.md 的完成條件（而不是留給 Lead 收尾時才發現），待裁決

### W2 觀察：SimSnapshot 目前只支援單車
- **輪次**：R2 架構審查發現，R7 追加一個依賴方，**R11 由 Lead 落地契約變更**
- **現況（已變更）**：`src/contract/sim.ts` 的 `SimSnapshot` 從 `kart: KartState` /
  `lap: LapState` 改為 `karts: readonly KartState[]` / `laps: readonly LapState[]` /
  `playerIndex: number`（索引對齊）。新增 `KartState.characterId`（對齊
  `CHARACTERS.md §2` 六人卡司的英文 slug）與 `WorldOptions`
  （`playerCharacterId?`、`aiOpponents?: readonly AiOpponentConfig[]`）。
  `setInput()` 語意不變，只控制 `playerIndex` 那台車；AI 對手輸入完全在
  `step()` 內部決定，禁止 `Math.random()`，只能用 fixture 的 `seed` 衍生
- **相容性保證**：`createWorld()` 不傳 `WorldOptions` 或 `aiOpponents` 傳空陣列＝
  跟變更前完全一樣的單車行為，十輪累積的 telemetry 探針零改動即可繼續跑
- **消費端影響（已用 `npm run typecheck` 逐一確認範圍）**：
  - `src/render/renderer.ts`——**Lead 已改完**，多車繪製 + 玩家車決定相機/HUD，
    typecheck/build 皆 exit 0
  - `src/loader/bootstrap.ts`——零改動，只轉傳整個 `SimSnapshot`
  - `src/physics/world.ts`、`tools/telemetry/ghost-replay.mjs`、
    `tools/validate/w1-physics.mjs`——**待 Codex**，屬 R11 任務範圍
    （見 `loop/round-11/TASK.md`），typecheck 目前對 `world.ts` 報兩個
    預期中的錯誤（缺 `characterId`、`kart` 欄位已不存在），這是正常的
    「還沒接上」編譯期訊號，不是回歸
- **新增依賴（R7）**：`BAR-FEEL §6.4 kart_kart_impulse_symmetry` 現在有陣列可以
  承載第二台車了，但**車對車碰撞物理本身還不存在**——`step()` 目前只算
  牆面碰撞。R11 任務要求 Codex 設計並實作 kart-kart 碰撞（沿用
  `collisionImpulse` 這個既有純量欄位，細節走 events，不擴大 `KartState`）
- **狀態**：架構設計與渲染端已落地（R11 前置），物理端與 telemetry 消費端
  的機械式更新＋新碰撞邏輯已開任務給 Codex（`loop/round-11/TASK.md`）

### 外部架構審查的三項欄位建議 —— 已核實，兩項採納一項駁回
- **輪次**：R2 架構審查
- **收到的建議**：`SimSnapshot` 該有 `topSpeedRatio`、`boostActive`、`boostSource`；
  `surface`／`state` 的 enum 值域跟 `BAR-FEEL §1.2` 不一致（含 `spinout`）
- **核實過程**：對整份 `BAR-FEEL.md` 執行 `grep -in spin`，零筆命中；
  比對 §1.2 的 `surface` 值域（`asphalt|dirt|grass|boost`）與 `KartState.surface`，
  **逐字相同**；§1.2 沒有任何 `state`（非 `drift_state`）欄位
- **結論**：`surface`／`state`／`spinout` 的不一致**不存在於這個 repo**，
  審查描述的內容對應不到任何實際檔案，判定為 fabricated，未採納，
  `BAR-FEEL.md` 未改動
- **`topSpeedRatio`**：未採納。`speed / BASE_TOP_SPEED` 在 validator 端就能算，
  不必存進 telemetry，加了是多一份要保持同步的冗餘資料
- **`boostActive`/`boostSource`**：未採納。對應道具箱加速，屬 W4 範圍，
  `BAR-FEEL` 目前沒有任何相關窗口定義，現在加等於臆測未規格化的東西
- **狀態**：已裁決，不採納，記錄於此避免同樣的建議被重新提出時要重查一次

### W2 觀察：穩態轉彎完全不損速
- **輪次**：R1 審查發現
- **現況**：直線與全鎖轉向的穩態速度都是 24.00，保留率 `1.0000`。
  急轉瞬間會掉到 `0.7166` 但完全回復。來源是 R1 新增的 `targetGroundSpeed` 重標定
- **目標**：`BAR-FEEL §4.10 drift_speed_retention` 窗口 `[0.88, 0.97]`
- **落差**：穩態保留率會卡在窗口外。極速上限未被突破，不是漏洞，是模型選擇
- **狀態**：W2 的 `drift-miniturbo` 元件處理，本輪不動

### W2 觀察：§5.3 目前為 0s
- **輪次**：R1 審查發現
- **現況**：放開轉向後 `yaw_rate` 一個 tick 內歸零，yaw 模型無慣性
- **目標**：`BAR-FEEL §5.3` 窗口 `[0.15, 0.35]`
- **落差**：低於窗口。**但 R1 的任務是讓它「可量測」而非「在窗口內」，任務已達成**
- **狀態**：W2 的 `steering-grip` 元件處理

### BAR-VISUAL §5.1–§5.12 個別元件條款未寫
- **輪次**：R0
- **現況**：§5.0 全元件共通條款已從 Art Bible v5 填妥，個別元件條款空白
- **目標**：12 元件各有材質細節、色彩、比例條款與一句「一眼判斷」檢查句
- **影響**：**不擋 W3 啟動。** LOOP-OPS §5 規定先把 12 元件做到「堪用」再 loop，
  §5.0 足以支撐堪用階段。個別條款在進入 loop 前補，屆時有實際產出可對照，會寫得更準
- **狀態**：**已完成（R20）**。12 條全數補齊，統一格式為**材質 / 色 / 比例 /
  一眼判斷**。當初「等有產出再寫會更準」的判斷是對的：`§5.3` 的
  「笑口必須在正面看得到，裝到車上被擋住也算沒做到」就是 R20 接線時實測出來的，
  沒有實際產出寫不出這一條

### BAR-FEEL 缺 AI 對手的行為指標
- **輪次**：R0，R11 釐清範圍邊界
- **現況**：`ai-opponents` 已排入 W2 第 8 順位，但只有碰撞（§6）有指標
- **目標**：超車決策、橡皮筋強度、難度分級的可量測窗口
- **影響**：**不擋 R11**——R11 只做多車架構的機械式落地與 kart-kart 碰撞
  物理（仍屬 §6 既有範圍），對手車在 R11 是無決策的佔位符（固定輸入或
  靜止），不需要 `src/ai/` 邏輯。真正的 AI 決策（超車、橡皮筋、難度）
  要進 `src/ai/` 才需要這份指標，那是**進入 `ai-opponents` 元件本身**
  （而不是它的前置架構回合）之前必須補的東西
- **狀態**：待裁決，觸發點＝R11 落地後、真正 AI 決策開工前

### 文件標點全半形不一致
- **輪次**：R0
- **現況**：`BAR-FEEL.md` / `LOOP-OPS.md` 用全形（，：（）），
  `CHARACTERS.md` / `BAR-PERF.md` / `BAR-VISUAL.md` 用半形
- **影響**：純觀感。三個工具都讀得懂，不影響任何驗收
- **狀態**：待裁決（建議留給每波結束的 smoothing pass 一併處理）

---

## 已裁決

### ~~契約缺輸入路徑、歸屬混在 Cursor 目錄、tick 迴圈可能被重寫兩次~~ — 已修
- **輪次**：R2 架構審查
- **核實**：`bootstrap.ts:84` 的 `const world: SimWorld = createWorld()` 把型別窄化，
  `SimWorld` 沒宣告 `setInput`，Cursor 就算想接線也過不了 typecheck——比審查原本說的
  「完全沒有路徑」更精確：Codex 在 R1 已經做出 `setInput()` 且驗證過決定性，
  缺的是契約沒把它收進來
- **處置**：
  1. 新增 `src/contract/sim.ts`（Lead 專屬），`SimWorld` 正式納入 `setInput`
  2. `bootstrap.ts` 瘦身為純執行迴圈，型別從 `@contract/sim` re-export，
     `src/physics/world.ts`／`src/render/renderer.ts` 零改動（結構化型別，驗證過 build 通過）
  3. 新增共用 `advance(world, ticks, poll)`，瀏覽器迴圈與未來的 ghost-replay
     共用同一份 tick 驅動邏輯，避免兩份實作漂移（症狀是手感在窗口邊緣震盪）
  4. `bootstrap()` 新增 `InputSource` 參數，預設 no-op，Cursor 只需實作
     `poll(tick): WorldInput` 並在 `main.ts` 傳入——`TASK-cursor.md` 已同步更新，
     原本的「兩個型別／契約問題」章節已解決，三條硬性約束簡化為兩條
  5. `ARCHITECTURE.md`「目前缺口」章節是過期內容（寫著 `@physics/world`／
     `@render/renderer` 待實作，但兩者 R1/R2 已完成），已更新為現況並修正約束二/三
  6. `LOOP-OPS.md` §2 補一筆實作偏離，說明 `src/contract/` 為何不屬於
     手冊原本三方寫入範圍表的任何一格
- **拒絕的部分**：審查建議把 `step(dt)` 改成 `step(dt, input)`，
  會強迫 Codex 重寫並重新驗證 R1 已通過的 `setInput()` 設計，
  换來的架構純度提升不值得那個成本——兩種呼叫慣例在「輸入於 tick 邊界進入」
  這件事上是等價的，維持既有可行、已驗證的設計
- **驗證**：main 上 `typecheck`／`build` exit 0，`tools/validate/w1-physics.mjs` 仍 PASS

### ~~輸入來源沒有接線，車不可操控~~ — 已指派
- **原記錄（R1）**：`setInput()` 無呼叫端，Lead 拆 W1 時沒指派歸屬
- **裁決**：歸 **Cursor**（`src/ui/` + `src/loader/` 都在其範圍）。
  已開 `loop/round-2/TASK-cursor.md`，含三條硬性約束
  （可被固定序列取代、取樣點在 tick 不在動畫幀、不破壞固定步長契約）
- **教訓**：拆 W1 時只想到「三個工具各做一塊」，沒檢查三塊拼起來是否構成
  「可玩」。下次定義完成條件時，先問「玩家實際做得到什麼」

### ~~BAR-VISUAL §5 未完成，W3 被封鎖~~ — **判斷錯誤，已撤回**
- **原判斷（R0 bootstrap）**：缺 Art Bible，W3 無法啟動
- **實際**：`podcast-website/docs/UNIVERSE-ART-BIBLE.md` 已是 v5，
  含黃金樣本（`car-park.png`，標為最高權威）、黏土材質、燈光、配色全部齊備。
  `GAMEKIT-ART-BIBLE.md` 另有調色盤與技術錨點，但那是**像素風產品線，不適用**
- **處置**：已複製定義層進 `refs/clay/`（14 張）與 `BAR-VISUAL §5.0`。W3 未被封鎖
- **教訓**：bootstrap 時假設素材不存在而沒有實際去看上游 repo。
  下次寫「被 X 封鎖」之前先確認 X 是否真的不存在

### ~~git 全域身分為佔位值~~ — 已處置
- 已設 repo-local 身分為 `godmosword.eth / godmosword@gmail.com`
- 若非期望值請自行改，不影響任何驗收
