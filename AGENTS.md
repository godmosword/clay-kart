# AGENTS — 先確認你是誰

這個 repo 由三個工具協作，各自佔一個 git worktree。
**先看你在哪個目錄，再讀對應的任務書。**

```bash
pwd                                # 你在哪
git rev-parse --abbrev-ref HEAD    # 哪個分支
```

| 目錄 | 分支 | 你是 | 讀這份 |
|---|---|---|---|
| `ck-physics` | `feat/physics` | Codex | **[CODEX.md](CODEX.md)** |
| `ck-visual` | `feat/visual` | Claude Code | [prompts/claude-builder.md](prompts/claude-builder.md) |
| `ck-plumb` | `feat/plumb` | Cursor | [prompts/cursor-chores.md](prompts/cursor-chores.md) |
| `clay-kart` | `main` | Lead | [loop/PLAN.md](loop/PLAN.md) |

---

## 三條所有人都適用的規則

1. **只寫自己的路徑。** 可以讀全部，只能寫自己那份。違反即 revert。
   範圍表在 [loop/PLAN.md](loop/PLAN.md) 末段。

2. **`loop/FROZEN.md` 列出的檔案任何人不得修改。**
   每輪開頭必讀。要改就寫進 `loop/BACKLOG.md` 由 Lead 裁決。

3. **驗收標準（`BAR-*.md`、`CHARACTERS.md`）只有 Lead 可寫。**
   builder 改驗收標準等同自己改考卷。

## 協調狀態寫在 main，不是寫在自己的 worktree

每個 worktree 都有一份 `loop/` 和 `progress/` 拷貝，但那是各分支獨立的檔案。
在自己的 worktree 更新，`main` 上的儀表板永遠看不到。

| 內容 | 寫在哪 |
|---|---|
| 程式碼 | 自己的 worktree，自己的分支 |
| `loop/round-{N}/*`、`progress/*.json`、`BACKLOG.md`、`budget.json` | **`clay-kart/`，`main`** |

一律 `git pull --rebase`，不要 merge。詳見 [loop/README.md](loop/README.md)。
