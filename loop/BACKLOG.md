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

## 待裁決

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
- **狀態**：待裁決，記錄觸發點＝W3 開工前

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
- **狀態**：已裁決，機制已生效

### W2 觀察：SimSnapshot 目前只支援單車
- **輪次**：R2 架構審查發現，R7 追加一個依賴方
- **現況**：`SimSnapshot.kart` 是單數欄位，不是陣列
- **目標**：`BAR-FEEL §7`／`loop/PLAN.md` W2 第 8 元件 `ai-opponents` 需要多車
- **落差**：AI 對手需要跑同一份物理，`kart: KartState` 撐不住
- **為什麼不現在改**：`ai-opponents` 排在 W2 優先序最後，中間七個元件
  （sim-determinism 到 input-feedback）都是在單車 shape 上調物理數值。
  把 `kart` 包成 `karts: readonly KartState[]` 是純結構包裝，不牽動物理邏輯，
  現在做跟等到 `ai-opponents` 開工前做，成本一樣——沒有隨時間複利的代價
- **新增依賴（R7）**：`BAR-FEEL §6.4 kart_kart_impulse_symmetry`（車對車碰撞
  對稱性）也卡在這個限制上——沒有第二台車可以撞。`collision-response`
  元件（R7）已指示跳過 6.4，不強求
- **狀態**：已排入，觸發點＝`ai-opponents` 元件開工前

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
- **狀態**：已排入 W3 loop 前

### BAR-FEEL 缺 AI 對手的行為指標
- **輪次**：R0
- **現況**：`ai-opponents` 已排入 W2 第 8 順位，但只有碰撞（§6）有指標
- **目標**：超車決策、橡皮筋強度、難度分級的可量測窗口
- **影響**：不擋前七個元件。進入 `ai-opponents` 前必須補
- **狀態**：待裁決

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
