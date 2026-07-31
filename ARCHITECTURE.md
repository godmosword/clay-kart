# 架構約束

> W1 骨架定下的硬性約束。三個工具都必須遵守。
> 這些不是風格偏好 —— 違反其中任何一條，`BAR-FEEL §2` 的決定性驗收會垮掉。

---

## 技術棧

TypeScript + Vite + Three.js。

**選擇理由：** 黏土材質需要自訂 shader，Three 的 material extension 最好改；
生態最大；headless 重播走 Node，不需要瀏覽器。
Babylon 內建物理較強，但我們本來就要自己寫決定性物理，用不到那部分。

## 約束一：物理層必須 headless（最重要）

`src/physics/` **不得**：

- `import` three 或任何渲染相關套件
- 觸碰 `window`、`document`、`performance`、任何 DOM API
- 讀取 wall-clock 時間
- 使用未固定種子的亂數

**原因：** `tools/telemetry/ghost-replay`（LOOP-OPS §4.1）要在 Node 裡 headless 重播，
且同輸入跑三次必須 byte-identical。物理只要沾到瀏覽器或時間，這條就不可能成立。

## 約束二：固定步長，單向資料流

```
InputSource.poll() → world.setInput() → world.step(TICK_DT) → snapshot() → renderer.draw(snap, alpha)
```

- `step()` 的 dt 恆為 `TICK_DT`（1/120 s），不接受可變步長
- `setInput()` 必須在每個 `step()` 之前恰好呼叫一次，取樣點在 tick 邊界不在動畫幀
- `draw()` 的 `alpha` 只供視覺插值，**不得寫回模擬**
- 渲染層對 snapshot 唯讀
- `advance(world, ticks, poll)` 是共用的 tick 驅動函式——瀏覽器迴圈與
  `tools/telemetry/ghost-replay` 都要用它，不要各自重寫，否則兩份實作
  遲早漂移（症狀是手感在窗口邊緣震盪）

介面定義在 [src/contract/sim.ts](src/contract/sim.ts)（**Lead 專屬**）。
[src/loader/bootstrap.ts](src/loader/bootstrap.ts) 只保留執行迴圈，
從 `@contract/sim` re-export 型別以維持既有 import 路徑不變。

## 約束三：寫入範圍

| 路徑 | 工具 | 分支 |
|---|---|---|
| `src/contract/` | **Lead** | — |
| `src/physics/`, `src/ai/`, `tools/` | Codex | `feat/physics` |
| `src/render/`, `src/characters/`, `src/vfx/` | Claude Code | `feat/visual` |
| `src/ui/`, `src/loader/`, `build/` | Cursor | `feat/plumb` |

可讀全部，只能寫自己的。違反即 revert。

## 現況（2026-08-01 更新）

W1 骨架已完成，`@physics/world` 與 `@render/renderer` 皆已由各自工具實作
（不再是 stub）。`npm run typecheck`、`npm run build` 皆 exit 0。

當初留這節是為了說明一個設計不變量：兩個模組缺任何一個，
`typecheck`／`build` 就該失敗——讓「還沒接上」是編譯期事實，
不是執行期才發現。這條不變量現在仍然成立（拔掉任一實作重新試就知道），
只是目前兩者都已到位，缺口本身不存在了。
