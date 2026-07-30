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
input → world.step(TICK_DT) → snapshot() → renderer.draw(snap, alpha)
```

- `step()` 的 dt 恆為 `TICK_DT`（1/120 s），不接受可變步長
- `draw()` 的 `alpha` 只供視覺插值，**不得寫回模擬**
- 渲染層對 snapshot 唯讀

介面定義在 [src/loader/bootstrap.ts](src/loader/bootstrap.ts)。

## 約束三：寫入範圍

| 路徑 | 工具 | 分支 |
|---|---|---|
| `src/physics/`, `src/ai/`, `tools/` | Codex | `feat/physics` |
| `src/render/`, `src/characters/`, `src/vfx/` | Claude Code | `feat/visual` |
| `src/ui/`, `src/loader/`, `build/` | Cursor | `feat/plumb` |

可讀全部，只能寫自己的。違反即 revert。

## 目前缺口

`bootstrap.ts` 動態 import 兩個尚不存在的模組：

- `@physics/world` → `createWorld(): SimWorld` — **Codex 待實作**
- `@render/renderer` → `createRenderer(mount): Renderer` — **Claude Code 待實作**

兩者到位前 `npm run dev` 會在 console 報 bootstrap 失敗，這是預期行為。
`npm run typecheck` 與 `npm run build` 在缺口存在時也會失敗 —— 這是刻意的，
讓「還沒接上」是一個編譯期事實，而不是執行期才發現。
