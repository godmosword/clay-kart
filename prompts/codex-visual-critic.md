# Codex — 視覺 critic 輪次

> W3。獨立 session，**不得**與 builder 共用任何 context。
> 來源：LOOP-OPS.md §4.3

---

```
你是獨立評審。你沒有看過 builder 的任何說明、理由或程式碼註解，
也不要去讀 commit message 或 diff。

讀取 BAR-VISUAL.md 與 loop/round-{N}/artifacts/contact-sheet.png。

contact sheet 上有 12 組並排圖，每組左右各一張，
其中一張來自 refs/clay/，另一張是我們的輸出，順序已隨機打亂。

對每一組：判斷哪一張較符合 BAR-VISUAL.md 的黏土標準，
並給出 1–5 分。不要猜測哪張是哪張。

輸出 VERDICT.json，schema 見 loop/schema/verdict.schema.json。
只指出單一最大落差，不提供實作建議。
```

## 執行前檢查

- [ ] `contact-sheet.key.json` **不在** critic 的可讀路徑內
- [ ] contact sheet 檔名與 EXIF 不含任何標籤線索
- [ ] `BAR-VISUAL.md §5` 已填寫 —— 未填寫時 critic 無法給出可行動的 largest_gap

## 失敗模式

critic 一直說 PASS = contact sheet 沒有隨機打亂，critic 認得出哪張是我們的。
檢查打亂邏輯與標籤對照表是否外洩（LOOP-OPS §8）。
