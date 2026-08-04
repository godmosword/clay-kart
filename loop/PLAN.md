# PLAN — clay-kart 拆解

> Lead 產出，唯一真實來源。Builder 不得自行擴充範圍。
> 修改此文件只有 Lead 可以做。

---

## 目標

黏土風格卡丁車競速遊戲。素材來源為 `podcast-website` 的定義層（**複製，不共用檔案**，
兩 repo 保持獨立）。三工具協作，預算型停止（LOOP-OPS §6）。

## 四份 bar

| 文件 | 驗什麼 | critic |
|---|---|---|
| `BAR-FEEL.md` | 手感（模擬層） | Python，零成本 |
| `BAR-PERF.md` | 幀率、載入、記憶體、抽格 | Python，零成本 |
| `BAR-VISUAL.md` | 黏土美術 | Codex 盲測 A/B，**付費** |
| `CHARACTERS.md` | 角色規格、IP 界線 | 人工 + IP 自檢 |

**只有 `BAR-VISUAL` 需要 LLM。** 其餘三份全是確定性程式檢查。

## 波次總覽

| Wave | 目標 | 驗收 | 是否跑 loop |
|---|---|---|---|
| W1 | 可玩骨架 | 一台車、一條封閉賽道、圈數計時、能開不卡 | ✗ |
| W2 | 手感 | `BAR-FEEL` 全項 PASS（4.5 為硬門檻）+ `BAR-PERF §8` | ✓（critic 免費） |
| W3 | 視覺 | `BAR-VISUAL` 12 元件 ≥ 4 分 + 音效 | ✓（critic 付費，節制） |
| W4 | 內容 | 道具系統、其餘五位車手、更多賽道 | 待定 |

---

## W1 — 可玩骨架

**不跑 loop。達成即進 W2。這一波開 Opus 是純粹浪費。**

| # | 工具 | 工作 | 完成條件 |
|---|---|---|---|
| 1 | ~~Cursor~~ | ~~專案骨架、build pipeline、dev server~~ | ✅ **已完成**，見 `../ck-plumb/ARCHITECTURE.md` |
| 2 | Codex | 固定 tick 物理迴圈、碰撞、**封閉賽道 collider**、**圈數計時** | 120Hz 固定步長；車能動、能撞牆、不穿透；能跑完一圈並記錄圈速 |
| 3 | Claude Code (Sonnet) | 最小可用渲染、一台方塊車、追尾相機 | 畫面上看得到車在動，60fps |

> 順序已修正。手冊 §5 把骨架排第 2，但骨架是另外兩者的前提——沒有 build
> 就沒有 `src/physics/` 可以放。骨架完成後 2 與 3 可並行。

**W1 明確不做：** 漂移、道具、AI 對手、音效、任何材質工作、其餘五位車手。
車手只做小紅賽車（`CHARACTERS.md §2`），而且 W1 階段就是個方塊。

---

## W2 — 手感

**這一波不要用 Opus。** 手感是數值調校，Sonnet 完全夠用，critic 是 Python 免費。可以放心跑很多輪。

| # | 工具 | 工作 |
|---|---|---|
| 1 | Codex | telemetry + validate（LOOP-OPS §4.1）+ `perf-probe`（`BAR-PERF §7`），一次做完 ✅ R3 已完成 |
| 2 | **Codex** | builder 輪次，反覆 |
| 3 | Python | critic，零成本 |
| 4 | Cursor | 套 diff、跑 replay |

> **修正（R3 收尾）：** 原表第 2 項寫「Claude Code (Sonnet)」，是 `LOOP-OPS.md §1`
> 通用範本的殘留，跟本專案實際的寫入範圍表衝突——手感調校要改的是
> `src/physics/world.ts`，那是 Codex 的專屬寫入範圍（`ARCHITECTURE.md` 約束三），
> 不是 Claude Code 能碰的。builder 輪次改指派給 Codex；Claude Code 在 W2
> 沒有任務，除非之後某個元件真的需要碰 `src/render/`（目前沒有）。

### 元件與順序

依 `BAR-FEEL.md §9` 優先序排列：

| 順序 | 元件 | 主要 bar 條款 | cap |
|---|---|---|---|
| 1 | `sim-determinism` | §2 | 150k |
| 2 | `acceleration-curve` | §3 | 200k |
| 3 | `drift-miniturbo` | §4 ★ | 400k |
| 4 | `steering-grip` | §5 | 250k |
| 5 | `collision-response` | §6 | 200k |
| 6 | `airborne-landing` | §7 | 150k |
| 7 | `input-feedback` | §8 | 100k |
| 8 | `ai-opponents` | §6 + 行為指標待補 | 300k |

**`sim-determinism` 必須第一個 PASS 並凍結。** §2 沒過的話後面所有數值都不可信。

**`drift-miniturbo` 的 4.5 是硬門檻。** 撞 cap 不得跳過，由 Lead 裁決加碼——
這是 `BAR-FEEL` 唯一不適用預算型停止的指標。

**`ai-opponents` 排最後**，因為它的碰撞手感依賴 §6 已定案。行為指標（超車決策、
橡皮筋強度）在進入該元件前由 Lead 補進 `BAR-FEEL`。

---

## W3 — 視覺與音效

**前置已解除。** `BAR-VISUAL.md §5.0` 已從 Art Bible v5 填妥，`refs/clay/` 14 張參考圖已備妥，
黃金樣本 `refs/clay/car-park.png` 為最高權威。§5.1–§5.12 的個別條款在進入 loop 前補即可。

| # | 工具 | 工作 |
|---|---|---|
| 1 | Cursor | contact sheet 生成腳本（12 格 + 隨機打亂 + key 另存到 critic 讀不到的位置） |
| 2 | Claude Code (Opus + ultracode) | 視覺 builder |
| 3 | Codex | 盲測 A/B critic，一次評 12 項 |
| 4 | Claude Code (Sonnet) | 音效接線，沿用 podcast 既有音訊資產 |

**音效在 W3，不是 W4。** 來源見 `CHARACTERS.md §7` —— 上游主題曲與 AI 語音可 100% 複用，
是整個專案最省事的一塊。注意**不要**套用上游 `GAMEKIT-ART-BIBLE.md` 的 chiptune 規格，
那是像素風產品線。

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
| `../ck-visual` | `feat/visual` | Claude Code | `src/render/`, `src/characters/`, `src/vfx/`, `tools/visual/`※ |
| `../ck-physics` | `feat/physics` | Codex | `src/physics/`, `src/ai/`, `tools/telemetry/`, `tools/validate/` |
| `../ck-plumb` | `feat/plumb` | Cursor | `src/ui/`, `src/loader/`, `build/`, `tools/visual/`※ |

任何工具都可以**讀**其他 worktree，但只能**寫**自己的範圍。違反即在 review 時 revert。

> ※ **`tools/visual/` 是 W3 視覺工具共用目錄**（R18 Lead 裁決）。`ck-plumb` 在 R17
> 建立了 `contact-sheet.mjs`，`ck-visual` 在 R18 需要放 render harness 的驅動腳本——
> 兩者都不屬於彼此的既有路徑，但主題上都是 W3 視覺工具。
> **共用不等於可以互改：各自只擁有自己建立的檔案，不得修改對方的。**
> 理由：寫入範圍規則的目的是防止兩個工具同時改同一個檔案，不是禁止在同一個主題
> 目錄下各自新增檔案。渲染邏輯本身（場景、相機、材質、光照）仍全部留在 `src/render/`。

`loop/`、`BAR-*.md`、`progress/*.json` 的寫入規則見 `loop/README.md`。
