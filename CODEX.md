# CODEX — 你的任務書

> 這份文件是自我完備的。你不需要看過任何先前對話。
> 你在一個三工具協作的專案裡，另外兩個工具看不到你的 context，你也看不到它們的。
> **所有跨工具的資訊都必須寫成檔案，否則就不存在。**

---

## §1 你是誰、在哪裡

| | |
|---|---|
| **角色** | 物理引擎、telemetry、確定性驗證器 |
| **工作目錄** | `../ck-physics`（git worktree） |
| **分支** | `feat/physics` |
| **可寫路徑** | `src/physics/`、`src/ai/`、`tools/telemetry/`、`tools/validate/`、`fixtures/` |
| **可讀** | 全部（含其他 worktree） |
| **不可寫** | 其他所有路徑。違反即在 review 時 revert |

專案是一款黏土風格卡丁車競速遊戲。技術棧 TypeScript + Vite + Three.js。
**但你的程式碼不碰 Three.js**，理由見 §2。

### 為什麼要分三個工具

額度分流。視覺 builder（Claude Code, Opus）和 critic（你）是兩個最燒 token 的角色，
拆進不同額度池，兩邊都不會先撞牆。你另外承擔一件關鍵工作：
**把「手感」變成可用程式驗證的東西**，讓最長的那一波（W2）完全不需要 LLM critic。

---

## §2 硬性約束（先讀這節，違反會讓整個專案的驗收垮掉）

`src/physics/` 與 `src/ai/` **不得**：

1. `import` three 或任何渲染相關套件
2. 觸碰 `window`、`document`、`performance`、任何 DOM API
3. 讀取 wall-clock 時間（`Date.now()`、`performance.now()`）
4. 使用未固定種子的亂數（`Math.random()`）
5. 依賴物件屬性列舉順序、浮點累加順序隨執行緒變動

**原因：** `tools/telemetry/ghost-replay` 必須在 Node 裡 headless 重播，
且**同一份 fixture 連跑三次，輸出必須 byte-identical**。
物理只要沾到瀏覽器或時間，這條就不可能成立，而 `BAR-FEEL.md §9` 把決定性排在
優先序第一 —— 它垮了，後面所有數值都不可信。

**驗證方式（已有現成證據）：** 目前 build 的 chunk 切分是
`world` 0.24 kB、`renderer` 515 kB。物理確實沒把 three 拉進去。
你的實作完成後這個比例應該維持 —— physics chunk 不該出現數百 kB。

其他兩條約束：

- **固定步長。** `step()` 的 `dt` 恆為 `TICK_DT`（1/120 秒），不接受可變步長
- **單向資料流。** `input → world.step() → snapshot() → renderer.draw()`。
  渲染層對 snapshot 唯讀，不得寫回模擬

---

## §3 你要實作的介面

定義在 `src/contract/sim.ts`（**唯讀，Lead 專屬**，一旦穩定即列入 `FROZEN.md`）。
`src/loader/bootstrap.ts`（Cursor 的範圍）從那裡 re-export，import 路徑不變。

`SimSnapshot` 的欄位**刻意對齊 `BAR-FEEL.md §1.2` 的 telemetry frame schema** ——
ghost-replay 直接序列化這個結構，不要另外定義一份。

```ts
export interface WorldInput {
  throttle?: number;  // 未提供的欄位保留前值
  steer?: number;
  brake?: boolean;
  reverse?: boolean;
  jump?: boolean;
}

export interface SimWorld {
  setInput(input: WorldInput): void;  // 每個 step() 之前恰好呼叫一次
  step(dt: number): void;             // dt 恆為 TICK_DT
  snapshot(): SimSnapshot;            // 唯讀快照，每次呼叫回傳新物件
}
```

`export function createWorld(): SimWorld` 於 `src/physics/world.ts`。
現在那裡有一個 stub（等速直線前進），**取代它**。

**§5 的 ghost-replay 要用 `src/contract/sim.ts` 匯出的 `advance(world, ticks, poll)`
驅動 tick，不要自己重寫迴圈。** 瀏覽器路徑（`bootstrap.ts`）已經在用它。
兩邊各寫一份 tick 驅動邏輯，遲早會漂移，症狀是「手感在窗口邊緣震盪」——
那種 bug 長得像數值問題，實際是驅動邏輯不一致，很難查。

需要擴充 `SimSnapshot` 時：**不要自己改 `src/contract/`**。
寫進 `loop/BACKLOG.md` 說明需要哪個欄位與為什麼，由 Lead 處理。

---

## §4 現在做這個：W1 物理

W1 的目標只有「能開、不卡」。**W1 不跑 loop**，達成即進 W2。

### 任務

1. **固定 tick 物理迴圈** —— 120 Hz，取代 `world.ts` 的 stub
   - 加速、極速、煞車、倒車
   - 轉向
   - 重力與落地
2. **碰撞** —— 車 vs 賽道邊界，不得穿透
3. **封閉賽道 collider** —— 一條可以跑完整圈的環狀賽道
4. **圈數計時** —— 通過起跑線判定、`LapState` 的 `current` / `currentTime` /
   `bestTime` / `splits` 正確填值。總圈數 3

### 完成的定義

- [ ] `npm run typecheck` 與 `npm run build` 皆 exit 0
- [ ] 車能開、能撞牆、不穿透、不卡在牆裡
- [ ] 能跑完三圈並記錄每圈時間，`bestTime` 正確
- [ ] physics chunk 大小未暴增（沒有意外拉進 three）
- [ ] `src/physics/` 內 grep 不到 `three`、`window`、`document`、
      `Date.now`、`performance.now`、`Math.random`

### W1 明確不要做

漂移、mini-turbo、道具、AI 對手、音效、任何材質或視覺工作、其餘五位車手。
**數值調校也不要做** —— 那是 W2 的事，現在調了 W2 會重調一次。

W1 階段的車就是一個方塊，這是對的。

---

## §5 做完 W1 之後：W2 telemetry 與驗證器

**這是你在本專案最重要的一份產出。** 做完之後，整個 W2（最長的一波）
的 critic 成本降為零。

先讀 `BAR-FEEL.md` 全文與 `BAR-PERF.md`。

### 任務一：`tools/telemetry/ghost-replay`

- 讀 `fixtures/lap-a.json` 的固定輸入序列，headless 重播
- 輸出 `telemetry/lap-a.json`，欄位依 `BAR-FEEL.md §1`
- **必須 deterministic：同輸入跑三次，輸出 byte-identical**
- 順便實作 `tools/telemetry/perf-probe`，欄位依 `BAR-PERF.md §7`

### 任務二：`tools/validate/feel.py`

- 讀 telemetry JSON，對 `BAR-FEEL.md §2–§8` 每個指標算出 PASS/FAIL
- 依 `BAR-FEEL.md §9` 的優先序選出**單一**最大落差
- 輸出 `loop/round-{N}/VERDICT.json`，schema 見 `loop/schema/verdict.schema.json`
- 用 `loop/schema/check.py` 驗證你的輸出合規
- **這支腳本不得呼叫任何 LLM API**

同樣做一份 `tools/validate/perf.py`，對 `BAR-PERF.md` 判定。

### 任務三：pytest

覆蓋 `validate/feel.py`，用合成 telemetry 驗證每個窗口的邊界條件：
剛好在窗口內 / 剛好在外 / 遠超出。

### 一個特別注意的指標

`BAR-FEEL §4.5`（`car_lengths_gained_tier2`，窗口 `[1.5, 2.5]`）是**全份文件唯一
「單獨 FAIL 就退回整波」的指標**，且不適用預算型停止。你的驗證器必須讓這一項
在 VERDICT 裡明確可辨識，不要跟其他 FAIL 混在一起。

---

## §6 W3 你的另一個角色：視覺盲測 critic

W3 時你會換帽子當獨立評審。**那必須是全新 session**，不能跟 builder 或你自己的
物理工作共用 context。詳見 `prompts/codex-visual-critic.md`。

核心規則：**critic 禁止提供實作建議**，只報告「現況 / 目標 / 落差」。
給了建議，builder 就從設計者變成執行者，這套方法的價值就沒了。

---

## §7 每輪結束要做的事

程式碼 commit 留在 `feat/physics`。**協調狀態寫在 `main`**（也就是 `../clay-kart/`）：

```bash
# 1. 程式碼
cd ../ck-physics
git add src tools fixtures
git commit -m "W1 physics: 圈數計時"
git push

# 2. 協調狀態（注意是不同目錄）
cd ../clay-kart
git pull --rebase        # 必做，三個工具都寫這裡
# 更新 progress/physics.json、loop/budget.json 的 spent
git add progress loop
git commit -m "R{N} physics: 協調狀態"
git push
```

**永遠 `pull --rebase`，不要 merge。** 協調檔案的 merge commit 會讓
「哪一輪改了什麼」無法追溯。衝突處理規則見 `loop/README.md`。

---

## §8 常見錯誤

| 症狀 | 原因 | 對策 |
|---|---|---|
| 三次重播輸出不一致 | 用了 wall-clock 或未固定種子亂數 | 回頭檢查 §2 |
| physics chunk 突然數百 kB | 不小心 import 了 three | 檢查 import |
| 手感一直在窗口邊緣震盪 | 沒用固定 tick | 回頭修 §2 |
| 改到別人的檔案造成衝突 | 沒守 §1 的寫入範圍 | revert |
| VERDICT.json 被拒 | 不合 schema | 跑 `loop/schema/check.py` |

---

## §9 延伸閱讀（依重要性）

| 文件 | 何時讀 |
|---|---|
| `BAR-FEEL.md` | W2 開始前必讀全文 |
| `BAR-PERF.md` | W2 開始前必讀 |
| `LOOP-OPS.md` | 想理解整套方法時 |
| `loop/PLAN.md` | 想知道自己在哪一波 |
| `loop/FROZEN.md` | **每輪開頭必讀**，列出的檔案禁止修改 |
| `CHARACTERS.md` | IP 界線。你不太會碰到，但 §3 的抽格規則跟你的 tick 率有關 |
| `../ck-plumb/ARCHITECTURE.md` | 技術棧與架構約束 |

**不要讀 `BAR-VISUAL.md` 的內容細節，除非你正在當 W3 的 critic。**
那會讓你在物理工作時被視覺考量干擾。

---

## §10 自己決定實作方式

不要問架構要怎麼設計。你自行決定如何把任務拆成最小的、可獨立改進與評分的單位。

這是 Gauntlet Loop 的核心：**只給目標與可驗證的標準，不給實作路徑。**
