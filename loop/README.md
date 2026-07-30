# loop/ — 三方共享協定目錄

此目錄在 `main` 上，三個 worktree 都讀得到。
**context 隔離靠檔案系統強制執行**（LOOP-OPS §0.3）—— 三個工具看不到彼此的對話，
所以任何跨工具的資訊都必須寫進這裡，否則就不存在。

---

## ⚠️ 寫在哪裡（最容易搞錯的一點）

每個 worktree 都有一份 `loop/` 和 `progress/` 的拷貝，但**它們是各分支獨立的檔案**。
在自己的 worktree 更新 `progress/physics.json`，`main` 上的儀表板永遠看不到，
三方協調狀態會各自漂移。

**規則：**

| 內容 | 寫在哪 | 分支 |
|---|---|---|
| 程式碼 | 自己的 worktree（`../ck-*`） | 自己的 feature 分支 |
| `loop/round-{N}/*`、`progress/*.json`、`BACKLOG.md`、`budget.json` | **`clay-kart/`** | **`main`** |

```bash
# 每輪結束，回 main 更新協調狀態
cd ../clay-kart
git pull --rebase          # ← 必做。三個工具都寫這裡，不 pull 一定衝突
# 編輯 progress/physics.json、loop/budget.json、loop/round-{N}/VERDICT.json
git add progress loop && git commit -m "R{N} {element}: 協調狀態"
git push
```

程式碼的 commit 留在自己分支，協調狀態的 commit 進 main。兩者不混。

### 遠端衝突規則

`origin` = https://github.com/godmosword/clay-kart

三個工具都會寫 `main` 的協調檔案，衝突是必然的。規則：

| 檔案 | 衝突處理 |
|---|---|
| `progress/*.json` | 各工具只寫自己那份，衝突代表有人越界寫別人的，**revert 越界方** |
| `loop/budget.json` | 只改自己元件的 `spent`，衝突時取**兩邊各自的元件**手動合併，不要整檔覆蓋 |
| `loop/round-{N}/VERDICT.json` | 一輪只有一個 critic，不該衝突。若衝突代表同一輪跑了兩個 critic，**兩份都作廢重跑** |
| `BACKLOG.md` | append-only，衝突時兩邊都保留 |
| `PLAN.md` / `FROZEN.md` / `BAR-*.md` | 只有 Lead 寫。builder 這裡有改動 = 越界，revert |

**永遠 `git pull --rebase`，不要 merge。** 協調檔案的 merge commit 會讓
「哪一輪改了什麼」變得無法追溯，而那正是這套流程唯一的稽核線索。

---

## 檔案

| 檔案 | 誰寫 | 誰讀 |
|---|---|---|
| `PLAN.md` | **僅 Lead** | 全部 |
| `FROZEN.md` | **僅 Lead** | 全部（builder 每輪開頭必讀） |
| `BACKLOG.md` | 全部可 append | Lead |
| `budget.json` | builder 每輪更新 `spent` | 全部 |
| `schema/verdict.schema.json` | **僅 Lead** | critic |
| `round-{N}/TASK.md` | Lead | 該輪 builder |
| `round-{N}/VERDICT.json` | 該輪 critic | 下一輪 builder |
| `round-{N}/artifacts/` | builder | critic |

`BAR-FEEL.md` / `BAR-VISUAL.md` 在 repo 根目錄，**僅 Lead 可寫**。
Builder 修改驗收標準等同自己改考卷。

---

## 一輪的流程

```
Lead      → 寫 round-{N}/TASK.md（指定元件與範圍）
builder   → 讀 TASK.md + VERDICT.json(N-1) + FROZEN.md + BAR-*.md
          → 只修 largest_gap 一項
          → 產出 artifacts/，更新 budget.json，commit
critic    → 讀 artifacts/ + BAR-*.md（不讀 diff、不讀 commit message）
          → 寫 round-{N}/VERDICT.json
Lead      → PASS → 更新 FROZEN.md，開下一元件
          → FAIL → 開 round-{N+1}
          → 撞 cap → 寫 BACKLOG.md，強制換元件
```

## 硬性規則

1. **Critic 禁止在 VERDICT 中提供實作建議。** 只報告「現況 / 目標 / 落差」。
   給了建議，builder 就變成執行者而非設計者，會失去 Gauntlet Loop 的價值。
2. **Builder 只修 `largest_gap` 一項。** 不要順手改其他 FAIL 項。
3. **VERDICT.json 必須自我完備。** 假設讀者對本專案一無所知。
4. **`FROZEN.md` 列出的檔案任何人不得修改。**

## 驗證 VERDICT

```bash
npx ajv-cli validate -s loop/schema/verdict.schema.json -d loop/round-7/VERDICT.json
```

或用 Python：

```bash
python3 -c "
import json, sys
from jsonschema import validate
validate(json.load(open(sys.argv[1])), json.load(open('loop/schema/verdict.schema.json')))
print('VERDICT ok')
" loop/round-7/VERDICT.json
```
