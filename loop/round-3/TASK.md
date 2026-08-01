# R3 — W2 開場：telemetry + validator

**Wave:** W2（手感）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前置：W1 已完成，經獨立驗證**——見下方「W1 收尾結果」。

---

## 這是你在本專案最重要的一份產出

做完之後，整個 W2（最長的一波）的 critic 成本降為零。詳細任務規格在
`CODEX.md §5`，這裡只列本輪範圍與一件從上一輪拖過來的尾巴。

### 任務一：`tools/telemetry/ghost-replay`
- 讀固定輸入序列，headless 重播，輸出 `telemetry/lap-a.json`
- **必須 deterministic**：同輸入跑三次，輸出 byte-identical
- 用 `src/contract/sim.ts` 匯出的 `advance(world, ticks, poll)` 驅動 tick，
  不要自己重寫迴圈——瀏覽器路徑已經在用它，兩份實作遲早漂移
- 順便做 `tools/telemetry/perf-probe`（`BAR-PERF.md §7`）

### 任務二：`tools/validate/feel.py`
- 讀 telemetry JSON，依 `BAR-FEEL.md §2–§8` 判 PASS/FAIL
- 依 `§9` 優先序選單一 `largest_gap`
- 輸出 `loop/round-{N}/VERDICT.json`，用 `loop/schema/check.py` 驗證合規
- 不得呼叫任何 LLM API
- 同樣做 `tools/validate/perf.py` 判 `BAR-PERF.md`

### 任務三：pytest
覆蓋 `feel.py`，合成 telemetry 驗證每個窗口邊界（剛好在內/剛好在外/遠超出）。

---

## 一件從 R2 拖過來還沒做的事

`loop/round-2/TASK-codex.md` 的落差二你沒修：`tools/validate/w1-physics.mjs`
第 29/100/111 行仍是本地寫死的 `const TRACK_RADIUS = 30`，當賽道**圓心**的 Z
座標用，但那其實是**半徑**，只是數值剛好都是 30 才沒露餡。

你正要建立 `ghost-replay` 這個新的 telemetry harness，它多半也需要讀賽道幾何來
判斷碰撞/越界。**這次直接從 `@physics/constants` 的 `TRACK_GEOMETRY` 匯入**
（`centerX`、`centerZ`、`radius`、`halfWidth` 都在），不要再手動抄一份數字——
`w1-physics.mjs` 順手一併修掉。W3 有四條賽道主題，圓心一旦不等於半徑，
沒改的話這支測試會**靜默驗錯位置，還回報 PASS**。

---

## W1 收尾結果（你不用重做，這裡是給你 context）

三個工具的 W1 收尾任務全部驗證通過：

- **物理**（你的 R1/R2）：固定 120Hz、決定性、封閉賽道碰撞、3 圈計時，
  `yaw_rate` 可收斂、位置為真實物理積分（不再貼齊中心線）
- **渲染**（Claude Code）：賽道網格、追尾相機（14.7° 俯角）、圈數 HUD，
  幾何從 `TRACK_GEOMETRY` 讀取
- **輸入**（Cursor）：鍵盤 + 觸控，經 `InputSource.poll()` 在 tick 邊界送入。
  **這項我沒有只看程式碼就簽核**——用 CDP 對真實瀏覽器送合成鍵盤事件，
  直接讀取模擬內部的 `yaw`/`speed`/`steerInput`，確認油門真的推進位置、
  轉向真的改變 yaw、放開真的歸零，全部用真實數字核對過

Lead 這輪也修掉自己犯了兩次的流程漏洞：builder push 完程式碼到自己分支，
沒有自動代表 `main` 拿到那份程式碼，之前有兩次（你的物理、Claude 的渲染）
只更新了 `progress/*.json` 卻忘了真的 merge。現在每輪收尾前會跑一個
`git merge-base` 檢查，這輪寫完就當場抓到第三次（Cursor 的輸入接線）。
跟你沒關係，純粹是我這邊的流程問題，記錄在 `loop/BACKLOG.md`。

---

## 完成的定義

- [ ] `ghost-replay` 三次重播 byte-identical
- [ ] `feel.py`／`perf.py` 輸出的 `VERDICT.json` 通過 `loop/schema/check.py`
- [ ] pytest 覆蓋邊界條件
- [ ] `w1-physics.mjs` 改用 `TRACK_GEOMETRY`，不再手動抄座標
- [ ] 上述腳本皆不呼叫 LLM API
- [ ] `npm run typecheck`、`npm run build`、既有 harness 仍全部通過

## 不要做

不要動 `BAR-FEEL.md`／`BAR-PERF.md` 的數值窗口。不要開始調 `world.ts` 的手感
（漂移、mini-turbo）——那是下一輪，等 validator 就位、有 telemetry 可比對之後才開始。

## 實作方式由你決定

不要問架構。fixture 格式、telemetry 的檔案佈局都由你設計。
