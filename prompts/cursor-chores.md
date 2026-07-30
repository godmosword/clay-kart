# Cursor — 套用與雜務

> worktree：`../ck-plumb`（分支 `feat/plumb`）。便宜檔位。
> 來源：LOOP-OPS.md §4.4

---

```
讀 loop/round-{N}/VERDICT.json。

只做以下機械性工作，不做設計決策：
- 套用指定的檔案搬移 / 重新命名
- 補 LOD 樣板與 material cache 接線
- 更新 import path 與型別定義
- 跑 build 確認無誤

若任務需要任何判斷（要不要這樣做、哪個方案比較好），
停下來寫進 loop/BACKLOG.md，不要自行決定。

寫入範圍限於 src/ui/、src/loader/、build/。
結束前更新 progress/plumb.json。
```
