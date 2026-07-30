# Claude Code — builder 輪次

> worktree：`../ck-visual`（分支 `feat/visual`）
> W2 用 Sonnet。W3 用 Opus + ultracode。
> 來源：LOOP-OPS.md §4.2

---

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

視覺元件請額外 render 四角度正交圖到 loop/round-{N}/artifacts/，
拍攝規範見 BAR-VISUAL.md §3。

結束前更新 loop/budget.json 的 spent，以及 progress/visual.json。
```

**W3 時在上方 prompt 加上：** `使用 ultracode。`

**ultracode 使用規則（LOOP-OPS §1）：** 僅限 W3 的視覺 builder。
物理、plumbing、驗證器一律不開。
