# BACKLOG — 撞預算上限而未解決的落差

> 兩種東西寫進這裡：
> 1. 元件撞到 `budget.json` 的 cap 但未達 bar，剩餘落差
> 2. Cursor 遇到需要判斷的任務（LOOP-OPS §4.4），停下來寫在這裡
>
> Lead 定期裁決。Agent 不得自行從此清單取項目來做。

---

## 格式

```markdown
### {element} — {簡述}
- **輪次**：R{N}
- **現況**：{指標} = {實際值}
- **目標**：{窗口}
- **已嘗試**：{方向一}、{方向二}
- **來源**：{工具}
- **狀態**：待裁決 | 已排入 R{N} | 放棄
```

---

## 待裁決

### BAR-VISUAL §5 未完成
- **輪次**：R0（bootstrap）
- **現況**：`BAR-VISUAL.md §5` 各元件美學條款空白
- **目標**：12 元件各有材質/色彩/比例條款與一句「一眼判斷」檢查句
- **阻擋**：缺 Art Bible、`refs/clay/` 12 張參考圖、`refs/lighting/neutral-3point.json`
- **影響**：W3 loop 無法啟動。W1/W2 不受影響
- **來源**：Lead bootstrap
- **狀態**：待裁決

### git 全域身分為佔位值
- **輪次**：R0（bootstrap）
- **現況**：全域 `user.name` = `你的名稱`，`user.email` = `your-github-username@users.noreply.github.com`
- **處置**：已設 repo-local 身分為 `godmosword.eth / godmosword@gmail.com`
- **來源**：Lead bootstrap
- **狀態**：待確認是否為期望值

---

## 已裁決

（無）
