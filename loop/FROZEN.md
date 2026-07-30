# FROZEN — 禁止修改

以下檔案已通過對應 bar，任何 agent 不得修改。
若確信需要改動，寫進 `loop/BACKLOG.md` 由 Lead 裁決。

> 長跑最大的浪費不是難題解不掉，是 agent 反覆重新推翻已經解決的東西。
> 這份清單省下的額度可能比其他所有措施加起來還多。

---

## 永久凍結（基礎設施）

尚無。`tools/telemetry/*` 在 Codex 完成 LOOP-OPS §4.1 後立即加入。

## W2

尚無。

## W3

尚無。

---

## 加入規則

一個檔案加入此清單，必須同時滿足：

1. 對應元件在某輪 `VERDICT.json` 中 `verdict == "PASS"`
2. 該輪的 telemetry / artifact 已 commit
3. 記錄格式：`- 路徑    # R{輪次} PASS, {bar 條款}`

**撞到預算上限而未 PASS 的元件，其檔案不進 FROZEN**（LOOP-OPS §6），
留待日後回頭。落差寫進 `BACKLOG.md`。
