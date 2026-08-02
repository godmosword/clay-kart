# R14 — `ai-opponents`：真正的 AI 駕駛決策（§12 落地）

**Wave:** W2
**Element:** `ai-opponents`（`loop/budget.json` cap 300000，見 `BAR-FEEL §12`——
**新增章節**，這輪開工前已補進 `BAR-FEEL.md`）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R13 `112ff16`——6.5 貼牆判定、5.5/5.6 surface 懲罰。我獨立
驗證屬實（重跑 typecheck/build/pytest、重新產生 telemetry 跟你的
VERDICT.json 逐項零差異），已合併進 main（`4a20329`）。

**先讀 `BAR-FEEL.md §12`（新增章節）**，這份任務是照那節的指標展開，
不要只看這裡的摘要。

---

## 現況：R11-R13 的 AI 對手從沒真的開過車

`R11` 落地了多車架構（`karts[]`/`playerIndex`、`WorldOptions.aiOpponents`），
但 AI 車一直是決定性的**靜止佔位符**（`Kart` constructor 裡 `if (ai) {
this.#throttle = 0; this.#brake = true; }`）——純粹為了讓 `6.4` 的
kart-kart 碰撞可測，從沒有任何駕駛邏輯。`loop/PLAN.md` 說得很清楚：
進入 `ai-opponents` 元件本身（不是 R11 那個純架構回合）前，行為指標要
先由 Lead 補進 `BAR-FEEL`。現在補完了，這輪就是真正開工。

---

## 這輪要做什麼

### 1. `src/ai/`：給 AI 對手一個能開車的決策邏輯

`ARCHITECTURE.md` 的寫入範圍表本來就把 `src/ai/` 劃給你，這輪是第一次
真的用到這個目錄。目標：讓 AI 車能自主繞賽道行駛，不是精緻的賽車 AI，
是「能完成一圈、難度有感、遇到前車會超」這個最低限度。

一個可能的最小做法（不是指令，你判斷）：每個 sim tick，對每台 AI 車
算一個簡單的比例控制器——用 `TRACK_GEOMETRY` 算出目前徑向偏移（相對
賽道中心半徑），轉向朝修正偏移的方向；油門朝著「`difficulty` 換算出的
目標速度」去催。這不需要真正的路徑規劃或碰撞預判，現有賽道是單一
圓環，跟著半徑走就是完整的racing line。

**跟 `setInput()` 走同一條路徑，不要幫 AI 車開特權物理**：AI 車的
決策應該產生一個 `WorldInput`-like 的值（throttle/steer/brake/...），
透過 `Kart` 現有的 `setInput()`（或等價路徑）套用，讓 AI 車跟玩家車
共用完全相同的加速曲線、轉向響應、甚至有能力觸發 drift——不要為了
方便另外寫一條繞過 `#stepDrive()`/`#stepYaw()` 的捷徑，那樣物理行為
會跟玩家車不一致，`BAR-FEEL §3`/`§5` 對 AI 車就失去意義。

`World.step()` 目前對每台 `Kart` 呼叫 `kart.step(fixedDt, tick)`，AI
車的決策要在這之前（同一個 tick 內）算出來、餵進去，介面怎麼設計
（`src/ai/` 匯出什麼函式、`Kart`/`World` 怎麼呼叫）你決定——這整條路徑
都在你的寫入範圍內，不需要新的跨工具契約。**唯一要求是決定性**：
不得用 `Math.random()`，需要變化性只能從 fixture 的 `seed` 衍生
（`src/contract/sim.ts` 的 doc comment 已經寫過這個限制）。

### 2. `difficulty` 要有真實效果

`AiOpponentConfig.difficulty`（`[0,1]`）目前存在契約裡但沒有任何實作
讀它。這輪至少要讓它影響目標巡航速度（`difficulty` 越高，目標速度越
接近 `BASE_TOP_SPEED`），讓 `12.3` 有東西可測。要不要也讓它影響轉向
積極度（抄近路 vs 走保守外線）你自己決定，不強求。

### 3. 四個新指標的 deterministic probe（`BAR-FEEL §12`）

```
12.1 ai_lap_completion            true         AI 自主完成一圈
12.2 ai_overtake_time_s           [1.0, 8.0]   追上並超越前方慢車所需時間
12.3 difficulty_lap_time_spread_s [3.0, 20.0]  difficulty=0 vs 1 的圈速差
12.4 rubberband_speed_bonus_ratio [1.0, 1.15]  落後時的最大速度加成上限
```

跟 R7 以來的每一輪一樣，這四項都需要專用 deterministic replay，不要
指望主 `lap-a` fixture（目前是單車情境）順便測出來。`12.4` 需要 AI
车落後玩家一段可控距離的情境（例如玩家車用固定較低油門開一段再催
到底、AI 全速追），量出 AI 在「落後多少距離」跟「速度加成」之間的
關係，取加成的上限。

**這四個窗口是 Lead 依設計意圖訂的第一版，不是先跑過你的實作量出來
再定的**——`BAR-FEEL §12` 的說明段已經寫了：如果實測出來某項窗口物理
上不合理（例如 `12.2`/`12.4` 互相矛盾），如實回報實際數字跟原因，
不要為了通過而扭曲 AI 行為，我再裁決是否調整窗口。這是這個專案一貫
的做法（`4.5`/`5.2` 當年也是先射後畫靶，中間調過）。

### 4. `tools/validate/feel.py`

`METRICS` 表（`feel.py` 開頭那個 tuple list）要加 `12.1`-`12.4` 四筆，
priority_rank 用 `10`（`BAR-FEEL §9` 已經加了「§12 全部，優先序最低」
這一條）。`calculate_metrics()` 要能從新 probe 的 meta 算出這四個值，
照既有 `_surface_speed_metrics`／`_kart_kart_events` 的模式（優先讀
專用 probe 的原始資料，不要讀 frame 層級的巧合預設值）。

---

## 完成的定義

- [ ] AI 對手能在標準 fixture 內自主完成至少一圈，不卡死、不永久脫離
      賽道（`12.1` PASS）
- [ ] `12.2`/`12.3`/`12.4` 有真實 probe 量測（若調不進窗口，如實記錄
      實際數字、已嘗試的方向，不虛構）
- [ ] AI 車走 `setInput()` 同一條物理路徑，不是特權捷徑——這條會在
      review 時對照 `#stepDrive()`/`#stepYaw()` 檢查
- [ ] 玩家車既有指標全數不退化：`4.5`（硬門檻）、§2/§3、5.2/5.5/5.6/
      5.7-5.9、6.1-6.5、7.3/7.4/7.5、8.1-8.4
- [ ] `6.4`（kart-kart 碰撞對稱性，R11 已 PASS）在 AI 車真的會動之後
      仍要 PASS——碰撞物理本身沒變，但現在 AI 車有速度了，確認一下
      沒有意外破壞
- [ ] ghost-replay 三次仍 byte-identical（含多車情境）
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `pytest` 全數通過
- [ ] 新的 `loop/round-14/VERDICT.json`，schema 驗證通過
- [ ] `loop/budget.json` 的 `ai-opponents.spent` 更新（目前 298953，
      cap 300000 幾乎打滿，這輪必然超支——不用控制在 cap 內，如實記錄
      就好，跟 W2 其他元件一樣）
- [ ] **收尾前自己跑一次 `loop/README.md` 的 merge-base 檢查**，回報
      commit hash 並標記 blocked 等 Lead 合併——不要自己合併進 main

## 這輪不做什麼

- 不做 per-character 物理調校（`CHARACTERS.md` 的重量級/輕量級差異）
- 不做「AI 領先太多被削速」的負向橡皮筋——`BAR-FEEL §12` 明講這節
  只定義落後時的正向加成
- 不做超車後的路線攻防、道具使用——那些是更進階的行為
- 不動渲染器——AI 車已經在畫了（R11 的多車繪製），這輪純物理/決策

## 實作方式由你決定

`src/ai/` 的介面設計、控制器怎麼寫、四個 probe 的具體情境設計——都你
決定。唯一不能動的是 `BAR-FEEL.md`（Lead-only）跟「AI 車必須走
`setInput()` 同一條物理路徑」這條要求。
