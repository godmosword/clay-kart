# loop/ — 三方共享協定目錄

此目錄在 `main` 上，三個 worktree 都讀得到。
**context 隔離靠檔案系統強制執行**（LOOP-OPS §0.3）—— 三個工具看不到彼此的對話，
所以任何跨工具的資訊都必須寫進這裡，否則就不存在。

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
