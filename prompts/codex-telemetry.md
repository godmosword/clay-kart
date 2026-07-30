# Codex — 建立 telemetry 與驗證器

> W2 開場，只做一次。worktree：`../ck-physics`（分支 `feat/physics`）
> 來源：LOOP-OPS.md §4.1

---

```
讀取 BAR-FEEL.md。

任務一：實作 tools/telemetry/ghost-replay
- 讀 fixtures/lap-a.json 的固定輸入序列，headless 重播
- 輸出 telemetry/lap-a.json，欄位依 BAR-FEEL.md §1
- 必須 deterministic：同輸入跑三次，輸出 byte-identical

任務二：實作 tools/validate/feel.py
- 讀 telemetry JSON，對 BAR-FEEL.md §2–§8 每個指標算出 PASS/FAIL
- 依 §9 的優先序選出單一最大落差
- 輸出 loop/round-{N}/VERDICT.json，schema 見 loop/schema/verdict.schema.json
- 這支腳本不得呼叫任何 LLM API

任務三：pytest 覆蓋 validate/feel.py，用合成 telemetry 驗證每個窗口的
邊界條件（剛好在窗口內 / 剛好在外 / 遠超出）。

寫入範圍限於 src/physics/、src/ai/、tools/telemetry/、tools/validate/。
其他 worktree 可讀不可寫。
```
