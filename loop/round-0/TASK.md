# R0 — Bootstrap

**Wave:** W1 準備
**Owner:** Lead
**狀態:** 完成

---

## 本輪範圍

建立三工具協作的協調基礎，不寫任何遊戲程式碼。

- [x] `git init`，`main` 分支，substrate 先進 main 再開 worktree
- [x] `loop/` 協定目錄（PLAN / FROZEN / BACKLOG / budget / schema）
- [x] `BAR-FEEL.md` —— Codex 的 §4.1 任務直接依賴
- [x] `BAR-VISUAL.md` 骨架 —— §5 待 Art Bible
- [x] `progress/` 監看
- [x] `prompts/` 四份 LOOP-OPS §4 樣板
- [x] 三個 worktree

## 刻意不做

以下屬於 W1 各工具的指定範圍，Lead 不越界：

- 專案骨架 / build pipeline / dev server → **Cursor**（`../ck-plumb`）
- 物理迴圈 / 碰撞 / 賽道 collider → **Codex**（`../ck-physics`）
- 最小渲染 / 方塊車 → **Claude Code Sonnet**（`../ck-visual`）

## 下一步

W1 依 `PLAN.md` 的順序啟動：Codex → Cursor → Claude Code。
三者可並行，因為寫入範圍不重疊。

**注意 W1 不跑 loop**，因此本輪沒有 `VERDICT.json`。
第一份 VERDICT 產生於 W2 R1，由 `tools/validate/feel.py` 輸出。
