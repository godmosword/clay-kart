# R15 — `ai-opponents`：讓 12.4 橡皮筋機制真的追得上，不只是理論上限

**Wave:** W2
**Element:** `ai-opponents`（`loop/budget.json` cap 300000，已用 719943，
這輪繼續超支，如實記錄即可，見 `BAR-FEEL §12.4`）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R14 修正版 `326283f`——`feel.py` 改為誠實回報
`observed_max_speed_ratio`，我獨立驗證屬實並合併進 main（`c935d31`）。
`12.1`-`12.3` PASS，`12.4=0.9626708488607413` 誠實 FAIL（窗口
`[1.0, 1.15]`）。

---

## 現況：加成目標一度封頂，但車速從沒真的追上

R14 的 rubberband probe（`playerStartAngle=2.5`、AI 從落後位置追、
`difficulty=0.5`）量出 `max_rubberband_gap=2.5`，已經超過觸發滿額加成
的門檻 `RUBBERBAND_FULL_GAP≈2.356`——代表 `src/ai/controller.ts`
`decideAiInput()` 算出的 `maxSpeedRatio` 確實一度封頂在 `1.1`。但整段
20 秒（2400 tick）probe 裡，AI 車**實際測到的速度**最高只到
`BASE_TOP_SPEED` 的 96.3%，從沒有真的超過基礎極速，離 1.1 倍還差得遠。

**我的推測（不是定論，你自己查）**：`decideAiInput()` 目前每個 tick
都用**即時**的 `progressGap` 重算 `gapFactor`/`maxSpeedRatio`/
`targetRatio`（`src/ai/controller.ts` 第 90-101 行）——沒有任何記憶或
平滑。AI 一旦因為加成開始加速、開始拉近距離，`progressGap` 立刻跟著
縮小，`gapFactor` 跟著往下掉，`targetRatio` 也跟著往下掉——加成目標
可能在車子的實際車速（受 `ENGINE_ACCELERATION` 的漸近加速曲線限制，
接近一個新目標本身就需要數秒，可參考 `BAR-FEEL §3.2` 的
`time_to_95pct_topspeed_s` 窗口 `[2.6, 3.4]` 當作量級參考）還沒追上
之前，就已經自我衰減掉了——變成一個追不到的移動目標。

這只是一個可能的根因，你要先用實際 debug/telemetry 確認是不是這個
機制在起作用，不要照單全收就動手改。

## 這輪要做什麼

讓 AI 落後時能真的測到接近／超過 `BASE_TOP_SPEED` 的速度，不只是讓
`decideAiInput()` 算出的理論上限封頂。方向由你判斷，可能的選項（不是
指令，也不是全部要做）：

- **對 gap 做平滑/記憶**：例如用一段時間內的 gap 平均或峰值，而不是
  純即時值，避免加成目標跟著車速貼身反向衰減
- **加成套用在加速度而非只有目標速度上**：讓落後時不只是目標速度變高，
  追趕當下的實際加速能力也提升，這樣才追得上一個提高的目標
- **重新設計 rubberband probe 情境**：如果你診斷後認為現行機制在合理
  的遊戲情境下其實是夠用的（例如真實對戰中 gap 通常不會像這個 probe
  一樣一開場就衝到 2.5 rad 那麼極端），可能是 probe 本身的參數
  （`playerStartAngle`/player 固定油門 0.28）製造了一個不現實的邊界
  情況——如果是這樣，如實回報你的分析，我再判斷是否要調整 probe 或
  調整窗口下限，而不是照樣硬調機制參數去湊一個不自然的測試情境

**唯一要求**：修完後 `12.4` 的數字要嘛真的落進 `[1.0, 1.15]`，要嘛
你如實回報做過的嘗試跟卡在哪——**不要走 R14 第一版的老路**，不准再用
任何形式的「配置值／理論值」取代 `observed_max_speed_ratio` 去湊
PASS。這條线是不可談判的。

## 完成的定義

- [ ] `12.4` 若能修到落在 `[1.0, 1.15]`，要用真實觀測值（不是配置值）
- [ ] 若修不進窗口，如實記錄實際數字、已嘗試的方向、你的診斷結論，
      記入 `loop/BACKLOG.md`，不強求這輪一定要 PASS
- [ ] `12.1`-`12.3`、`4.5`（硬門檻）、§2/§3/§5/§6/§7/§8 玩家車既有指標
      全數不退化
- [ ] 若改了 rubberband 對速度/加速度的套用方式，確認沒有意外影響
      difficulty 的圈速分級（`12.3`）——兩者都動到 `#stepDrive()` 的
      速度上限邏輯，可能互相影響
- [ ] ghost-replay 三次仍 byte-identical
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `pytest` 全數通過
- [ ] 新的 `loop/round-15/VERDICT.json`，schema 驗證通過
- [ ] `loop/budget.json` 的 `ai-opponents.spent` 更新（在 719943 上累加）
- [ ] **收尾前自己跑一次 `loop/README.md` 的 merge-base 檢查**，回報
      commit hash 並標記 blocked 等 Lead 合併——不要自己合併進 main

## 這輪不做什麼

- 不做多台 AI 對手同場（目前所有 §12 probe 都只測過一台 AI 對手，
  多台同場的驗證留給後續回合）
- 不做 per-character 物理調校
- 不做超車後的路線攻防、道具使用

## 實作方式由你決定

診斷方法、修正方向（平滑 gap／加速度加成／重新設計 probe／判斷現行
機制其實沒問題）都你決定。唯一不能動的是「不准用配置值頂替實測」這條
底線。
