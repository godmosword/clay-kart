# progress/ — 監看

三個工具各自寫一份 JSON，`index.html` 組合顯示。
**不要各寫各的 HTML**（LOOP-OPS §7）。

## 啟動

`fetch()` 在 `file://` 下被 CORS 擋掉，必須用靜態伺服器。
`index.html` 會讀 `../loop/budget.json`，所以**必須從 repo 根目錄起服務**，不能從 `progress/` 起：

```bash
# 在 repo 根目錄
python3 -m http.server 8080
```

然後開 `http://localhost:8080/progress/`。手機同網段可用機器 IP 開。

## JSON 契約

三份 `{visual,physics,plumb}.json` 共用同一組欄位：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `tool` | string | `claude-code` \| `codex` \| `cursor` |
| `worktree` | string | 相對路徑 |
| `branch` | string | |
| `updated` | ISO8601 | 每輪結束時更新 |
| `wave` | string | `W1`–`W4` |
| `round` | int | |
| `element` | string\|null | 當前元件 |
| `status` | enum | `idle` \| `building` \| `awaiting-critic` \| `blocked` \| `done` |
| `last_verdict` | `PASS`\|`FAIL`\|`BUDGET_EXHAUSTED`\|null | |
| `note` | string | 一句人話 |

## 規則

**這三份 JSON 一律寫在 `main`（`clay-kart/`），不是寫在自己的 worktree。**
在 worktree 更新的話儀表板讀不到 —— 見 [../loop/README.md](../loop/README.md) 開頭。

**不要中途打斷正在跑的 builder。** 要停就等該輪 commit 完再停。
