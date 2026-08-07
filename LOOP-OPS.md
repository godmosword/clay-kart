# LOOP-OPS.md — 三工具協作 Gauntlet Loop 作業手冊

> 適用於 clay-kart 專案。目標：在 Claude Code / Codex / Cursor 三個獨立額度池之間分流，
> 讓任何單一池都不會成為瓶頸，同時不犧牲 Gauntlet Loop 的核心（拆分、獨立評審、持續迭代）。

---

## 0. 設計原則

1. **按角色分流，不按工具偏好分流。** 決定用哪個工具的是「這個角色需要什麼能力」，不是「我比較習慣哪個」。
2. **能用確定性程式驗證的，絕不用 LLM。** 沿用 Q-Silicon 的三層審查架構。
3. **context 隔離靠檔案系統強制執行。** 三個工具本來就看不到彼此的對話，這是限制也是保障。
4. **已達標的東西凍結。** 長跑的浪費主要來自重做已解決的問題。
5. **預算型停止，不是完美型停止。**

---

## 1. 額度分流表

| 角色 | 工具 | 模型檔位 | 佔總成本估計 |
|---|---|---|---|
| Lead / 任務拆解 | claude.ai 對話，產出 `PLAN.md` | — | ~0% |
| 視覺 builder（mesh / 材質 / 光照 / VFX） | Claude Code | Opus 5 + ultracode | ~45% |
| 非視覺 builder（物理 / AI / UI 邏輯 / 音效） | Claude Code subagent | Sonnet | ~15% |
| 物理引擎、telemetry、確定性驗證器 | Codex | 預設 | ~15% |
| 視覺 critic（盲測 A/B） | Codex | 預設 | ~15% |
| 套 diff、LOD 樣板、plumbing、跑 dev server | Cursor | 便宜檔位 | ~10% |
| 手感 critic | Python，無 LLM | — | 0% |

**ultracode 使用規則：** 僅限 W3 的視覺 builder。物理、plumbing、驗證器一律不開。

---

## 2. 目錄與分支結構

### 初始化

```bash
git init clay-kart && cd clay-kart
git commit --allow-empty -m "init"

git worktree add ../ck-visual  -b feat/visual
git worktree add ../ck-physics -b feat/physics
git worktree add ../ck-plumb   -b feat/plumb
```

> **實作偏離：** 本專案改為「先把 `loop/`、`BAR-*.md` 等 substrate commit 進 `main`，再開 worktree」。
> 從空 commit 開分支會讓三個 worktree 都看不到協定檔案，違反 §0.3。

| 目錄 | 工具 | 可寫範圍 |
|---|---|---|
| `../ck-visual` | Claude Code | `src/render/`, `src/characters/`, `src/vfx/` |
| `../ck-physics` | Codex | `src/physics/`, `src/ai/`, `tools/telemetry/`, `tools/validate/` |
| `../ck-plumb` | Cursor | `src/ui/`, `src/loader/`, `build/`, 以及套用 critic 指定的 diff |

**跨界規則：** 任何工具都可以**讀**其他 worktree，但只能**寫**自己的範圍。違反即在 review 時 revert。

> **實作偏離（R2 架構審查後新增）：** `src/contract/` 是 **Lead 專屬**，不屬於上表任何一方。
> 原因：Codex 與 Claude Code 共同實作的介面契約（`SimWorld`／`KartState`／`Renderer` 等）
> 原本內嵌在 `src/loader/bootstrap.ts`，但那個目錄屬 Cursor 的可寫範圍——設計契約放在
> 被要求「不做設計決策」的工具的可寫目錄裡，directory-based 的權限表無法對單一檔案內
> 「哪幾行是誰的」做區分，是真實的結構性問題，不是理論疑慮。拆出 `src/contract/` 後，
> `src/loader/bootstrap.ts` 只保留執行迴圈，`src/contract/sim.ts` 一旦穩定即列入 `FROZEN.md`。

### 共享協定目錄（在 main 上，三方都讀）

```
loop/
  PLAN.md              # Lead 產出的拆解，唯一真實來源
  FROZEN.md            # 已達標、禁止修改的檔案清單
  BACKLOG.md           # 撞預算上限而未解決的落差
  budget.json          # 每個元件的剩餘預算
  round-{N}/
    TASK.md            # 本輪要處理的元件與範圍
    VERDICT.json       # critic 判決（結構化）
    artifacts/         # telemetry JSON、contact sheet PNG
```

---

## 3. VERDICT.json schema

Critic 的唯一輸出。必須**自我完備**——下一輪的 builder 在另一個工具裡，看不到任何前文。

機器可讀版本：`loop/schema/verdict.schema.json`

```json
{
  "round": 7,
  "wave": "W2",
  "element": "drift-miniturbo",
  "verdict": "FAIL",
  "bar_ref": "BAR-FEEL.md §4",
  "checks": [
    {
      "id": "4.3-tier2-charge",
      "metric": "tier2_charge_time_s",
      "actual": 2.34,
      "window": [1.90, 2.10],
      "status": "FAIL"
    },
    {
      "id": "4.5-core-feel",
      "metric": "car_lengths_gained",
      "actual": 1.2,
      "window": [1.5, 2.5],
      "status": "FAIL"
    }
  ],
  "largest_gap": {
    "id": "4.5-core-feel",
    "delta": "-0.3 車身 (低於下限 20%)",
    "priority_rank": 1
  },
  "artifacts": ["loop/round-7/artifacts/lap-a.json"],
  "next_owner": "claude-code",
  "tokens_spent_on_element": 184000,
  "budget_remaining": 216000
}
```

**Critic 禁止在 VERDICT 中提供實作建議。** 只報告「現況 / 目標 / 落差」。給了建議，builder 就變成執行者而非設計者，會失去 Gauntlet Loop 的價值。

---

## 4. 各工具 prompt 樣板

> 可直接複製的版本在 `prompts/`。

### 4.1 Codex — 建立 telemetry 與驗證器（W2 開場，只做一次）

```
讀取 BAR-FEEL.md。

任務一：實作 tools/telemetry/ghost-replay
- 讀 fixtures/lap-a.json 的固定輸入序列，headless 重播
- 輸出 telemetry/lap-a.json，欄位依 BAR-FEEL.md §1
- 必須 deterministic：同輸入跑三次，輸出 byte-identical

任務二：實作 tools/validate/feel.py
- 讀 telemetry JSON，對 BAR-FEEL.md §2–§8 每個指標算出 PASS/FAIL
- 依 §9 的優先序選出單一最大落差
- 輸出 loop/round-{N}/VERDICT.json，schema 見 LOOP-OPS.md §3
- 這支腳本不得呼叫任何 LLM API

任務三：pytest 覆蓋 validate/feel.py，用合成 telemetry 驗證每個窗口的
邊界條件（剛好在窗口內 / 剛好在外 / 遠超出）。
```

### 4.2 Claude Code — builder 輪次

```
讀取：
- loop/PLAN.md
- loop/FROZEN.md（列出的檔案禁止修改）
- loop/round-{N}/VERDICT.json
- BAR-FEEL.md（或 W3 時的 BAR-VISUAL.md）

只修復 VERDICT.json 的 largest_gap 一項。不要順手改其他 FAIL 項。
不要重構未列在本輪範圍內的程式碼。

自行決定實作方式，不要問我架構。

完成後執行 tools/telemetry/ghost-replay 並 commit，
commit message 格式：`R{N} {element}: {largest_gap.id}`

視覺元件請額外 render 四角度正交圖到 loop/round-{N}/artifacts/。
```

W3 時在此加上：`使用 ultracode。`

### 4.3 Codex — 視覺 critic 輪次

```
你是獨立評審。你沒有看過 builder 的任何說明、理由或程式碼註解，
也不要去讀 commit message 或 diff。

讀取 BAR-VISUAL.md 與 loop/round-{N}/artifacts/contact-sheet.png。

contact sheet 上有 12 組並排圖，每組左右各一張，
其中一張來自 refs/clay/，另一張是我們的輸出，順序已隨機打亂。

對每一組：判斷哪一張較符合 BAR-VISUAL.md 的黏土標準，
並給出 1–5 分。不要猜測哪張是哪張。

輸出 VERDICT.json，schema 見 LOOP-OPS.md §3。
只指出單一最大落差，不提供實作建議。
```

### 4.4 Cursor — 套用與雜務

```
讀 loop/round-{N}/VERDICT.json。

只做以下機械性工作，不做設計決策：
- 套用指定的檔案搬移 / 重新命名
- 補 LOD 樣板與 material cache 接線
- 更新 import path 與型別定義
- 跑 build 確認無誤

若任務需要任何判斷（要不要這樣做、哪個方案比較好），
停下來寫進 loop/BACKLOG.md，不要自行決定。
```

---

## 5. 每一波的排程

### W1 — 可玩骨架

| 順序 | 工具 | 工作 |
|---|---|---|
| 1 | Codex | 固定 tick 物理迴圈、碰撞、賽道 collider |
| 2 | Cursor | 專案骨架、build pipeline、dev server |
| 3 | Claude Code (Sonnet) | 最小可用渲染、一台方塊車 |

**W1 不跑 loop。** 目標只有「能開、不卡」，達成即進 W2。這一波開 Opus 是純粹浪費。

### W2 — 手感（最長的一波，但最便宜）

| 順序 | 工具 | 工作 |
|---|---|---|
| 1 | Codex | telemetry + validate（§4.1），一次做完 |
| 2 | Claude Code (Sonnet) | builder 輪次，反覆 |
| 3 | Python | critic，零成本 |
| 4 | Cursor | 套 diff、跑 replay |

這一波**不要用 Opus**。手感是數值調校，不是創造性視覺工作，Sonnet 完全夠用，而且 critic 免費。可以放心跑很多輪。

### W3 — 視覺（最貴，要最節制）

| 順序 | 工具 | 工作 |
|---|---|---|
| 1 | claude.ai 對話 | 從 Art Bible 產出 `BAR-VISUAL.md` |
| 2 | Cursor | contact sheet 生成腳本（12 格 + 隨機打亂 + 標籤對照表另存） |
| 3 | Claude Code (Opus + ultracode) | 視覺 builder |
| 4 | Codex | 盲測 A/B critic，一次評 12 項 |

**先把 §4.2 的 12 個元件全部做到「堪用」，再開始 loop。** 不要一個元件 loop 到完美才做下一個——你會在第三個元件就把額度燒光，而且第一個元件的美感標準會跟後面不一致。

### 每波結束 — smoothing pass

Claude Code，全新 session，Sonnet：

```
讀取整個 main 分支。你的任務不是重新設計，是讓各部分接得上。
找出風格不一致、重複實作、命名衝突、介面不對齊之處並修正。
不要新增功能。不要改動 FROZEN.md 列出的檔案。
```

---

## 6. 預算控制

### budget.json

```json
{
  "W2": {
    "drift-miniturbo": { "cap": 400000, "spent": 184000 },
    "acceleration-curve": { "cap": 200000, "spent": 51000 },
    "collision-response": { "cap": 200000, "spent": 0 }
  }
}
```

> **R25 裁決：cap 已廢除，`budget.json` 只記 `spent`。**
>
> cap 從來沒有擋下任何一輪——W2 超支 1.5x–10x，而 R7 起的 policy 明文
> 「不要求 builder 控制在 cap 內、如實記錄」。W3 四個元件做完，`spent` 全是 0，
> 沒人在記。**一個沒人執行但可能被相信的數字，比沒有數字更壞**——跟 `§2.5`
> 的假 PASS、`§4.1` 的 `not_applicable` 是同一類：看起來有防線，實際上沒有。
>
> 下面這段保留作為設計意圖的記錄。它描述的取捨（用預算取代完美）**本身是對的**，
> 失敗的是執行——沒有任何機制在 cap 被超過時真的停下來。若之後要恢復，
> 要先有那個機制，不是先有那個數字。

Builder 每輪結束後更新 `spent`。撞到 cap（**已廢除，以下為歷史**）：

1. 把剩餘落差寫進 `BACKLOG.md`（含現況數值、目標窗口、已嘗試方向）
2. 強制進入下一個元件
3. 該元件當輪的檔案**不進 FROZEN**，留待日後回頭

**這是對 Matt 原方法的刻意偏離。** 原版假設額度無限，可以無限逼近。你的版本用預算取代完美，代價是某些元件會停在 85% 而不是 95%。這個取捨是對的——12 個元件都到 85%，遠好過 3 個到 95% 而其餘沒做。

### FROZEN.md

```markdown
# FROZEN — 禁止修改

以下檔案已通過對應 bar，任何 agent 不得修改。
若確信需要改動，寫進 BACKLOG.md 由我裁決。

- src/physics/tick.ts          # R12 PASS, BAR-FEEL §2, §3
- src/physics/drift.ts         # R19 PASS, BAR-FEEL §4
- tools/telemetry/*            # 基礎設施，永久凍結
```

長跑最大的浪費不是難題解不掉，是 agent 反覆重新推翻已經解決的東西。這份清單省下的額度可能比其他所有措施加起來還多。

---

## 7. 監看

每個工具都各自維護一段 `progress.html`，但**不要各寫各的**。統一格式：

```
progress/
  index.html      # Cursor 維護，用 iframe 或 fetch 組合以下三份
  visual.json     # Claude Code 每輪寫入
  physics.json    # Codex 每輪寫入
  plumb.json      # Cursor 每輪寫入
```

`index.html` 顯示：各 wave 進度、每元件預算消耗長條圖、W2 的 telemetry 曲線疊圖、W3 的 contact sheet 縮圖時間軸。

手機開著看就好，**不要中途打斷正在跑的 builder**。要停就等該輪 commit 完再停。

---

## 8. 常見失敗模式

| 症狀 | 原因 | 對策 |
|---|---|---|
| 額度燒很快但品質沒進展 | critic 給了實作建議，builder 照做，變成執行者 | 檢查 VERDICT.json 是否混入建議 |
| 三個工具改到同一個檔案衝突 | 沒守 worktree 寫入範圍 | revert，重申範圍 |
| 手感一直在窗口邊緣震盪 | 沒用固定 tick，或 telemetry 非 deterministic | 回頭修 §4.1 任務一 |
| 視覺 critic 一直說 PASS | contact sheet 沒有隨機打亂，critic 認得出哪張是我們的 | 檢查打亂邏輯與標籤對照表是否外洩 |
| 後做的元件跟先做的風格不一致 | 逐一 loop 到完美，而非先全部堪用 | 回到 §5 W3 的順序規則 |
