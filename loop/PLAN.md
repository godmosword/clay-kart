# PLAN — clay-kart 拆解

> Lead 產出，唯一真實來源。Builder 不得自行擴充範圍。
> 修改此文件只有 Lead 可以做。

---

## 目標

黏土風格卡丁車競速遊戲。三工具協作，預算型停止（LOOP-OPS §6）。

## 波次總覽

| Wave | 目標 | 驗收 | 是否跑 loop |
|---|---|---|---|
| W1 | 可玩骨架 | 能開、不卡、不崩 | ✗ |
| W2 | 手感 | `BAR-FEEL.md` 全項 PASS 或撞預算 | ✓（critic 免費） |
| W3 | 視覺 | `BAR-VISUAL.md` 12 元件 ≥ 4 分 | ✓（critic 付費，節制） |
| W4 | 內容 | 道具、音效、AI 對手 | 待定 |

---

## W1 — 可玩骨架

**不跑 loop。達成即進 W2。這一波開 Opus 是純粹浪費。**

| # | 工具 | 工作 | 完成條件 |
|---|---|---|---|
| 1 | Codex | 固定 tick 物理迴圈、碰撞、賽道 collider | 120Hz 固定步長，車能動、能撞牆、不穿透 |
| 2 | Cursor | 專案骨架、build pipeline、dev server | `npm run dev` 起得來，`npm run build` 過 |
| 3 | Claude Code (Sonnet) | 最小可用渲染、一台方塊車 | 畫面上看得到車在動，60fps |

**W1 明確不做：** 漂移、道具、AI、音效、任何材質工作。

---

## W2 — 手感

**這一波不要用 Opus。** 手感是數值調校，Sonnet 完全夠用，critic 是 Python 免費。可以放心跑很多輪。

| # | 工具 | 工作 |
|---|---|---|
| 1 | Codex | telemetry + validate（LOOP-OPS §4.1），一次做完 |
| 2 | Claude Code (Sonnet) | builder 輪次，反覆 |
| 3 | Python | critic，零成本 |
| 4 | Cursor | 套 diff、跑 replay |

### 元件與順序

依 `BAR-FEEL.md §9` 優先序排列：

| 順序 | 元件 | 主要 bar 條款 | cap |
|---|---|---|---|
| 1 | `sim-determinism` | §2 | 150k |
| 2 | `acceleration-curve` | §3 | 200k |
| 3 | `drift-miniturbo` | §4 | 400k |
| 4 | `steering-grip` | §5 | 250k |
| 5 | `collision-response` | §6 | 200k |
| 6 | `airborne-landing` | §7 | 150k |
| 7 | `input-feedback` | §8 | 100k |

**`sim-determinism` 必須第一個 PASS 並凍結。** §2 沒過的話後面所有數值都不可信。

---

## W3 — 視覺

**前置封鎖：** `BAR-VISUAL.md §5` 未完成前不得啟動 loop。見該文件 §7。

| # | 工具 | 工作 |
|---|---|---|
| 1 | claude.ai 對話 | 從 Art Bible 產出 `BAR-VISUAL.md §5` |
| 2 | Cursor | contact sheet 生成腳本（12 格 + 隨機打亂 + key 另存） |
| 3 | Claude Code (Opus + ultracode) | 視覺 builder |
| 4 | Codex | 盲測 A/B critic，一次評 12 項 |

### 順序規則（重要）

**先把 12 個元件全部做到「堪用」，再開始 loop。**
不要一個元件 loop 到完美才做下一個 —— 會在第三個元件燒光額度，
且第一個元件的美感標準會跟後面不一致。

---

## W4 — 內容

W2/W3 結束後再拆。現在不規劃。

---

## 每波結束 — smoothing pass

Claude Code，全新 session，Sonnet：

```
讀取整個 main 分支。你的任務不是重新設計，是讓各部分接得上。
找出風格不一致、重複實作、命名衝突、介面不對齊之處並修正。
不要新增功能。不要改動 FROZEN.md 列出的檔案。
```

---

## 寫入範圍（硬性）

| worktree | 分支 | 工具 | 可寫路徑 |
|---|---|---|---|
| `../ck-visual` | `feat/visual` | Claude Code | `src/render/`, `src/characters/`, `src/vfx/` |
| `../ck-physics` | `feat/physics` | Codex | `src/physics/`, `src/ai/`, `tools/telemetry/`, `tools/validate/` |
| `../ck-plumb` | `feat/plumb` | Cursor | `src/ui/`, `src/loader/`, `build/` |

任何工具都可以**讀**其他 worktree，但只能**寫**自己的範圍。違反即在 review 時 revert。

`loop/`、`BAR-*.md`、`progress/*.json` 的寫入規則見 `loop/README.md`。
