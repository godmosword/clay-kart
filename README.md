# clay-kart

黏土風格卡丁車競速遊戲。以三工具協作的 Gauntlet Loop 開發
（Claude Code / Codex / Cursor，三個獨立額度池分流）。

作業手冊：[LOOP-OPS.md](LOOP-OPS.md)

---

## 現在在哪

**W1 進行中。** 專案骨架已完成並驗證（vite + ts + three，typecheck/build/dev 皆通）。
待 Codex 的物理迴圈與 Claude Code 的渲染。

素材來源是 `podcast-website` 的定義層，**已複製、不共用檔案**，兩個 repo 完全獨立。

## 四份 bar

| 文件 | 驗什麼 | critic 成本 |
|---|---|---|
| [BAR-FEEL.md](BAR-FEEL.md) | 手感（模擬層） | Python，零 |
| [BAR-PERF.md](BAR-PERF.md) | 幀率、載入、記憶體、抽格 | Python，零 |
| [BAR-VISUAL.md](BAR-VISUAL.md) | 黏土美術 | Codex 盲測，**付費** |
| [CHARACTERS.md](CHARACTERS.md) | 角色規格、**IP 界線** | 人工 |

四份都**僅 Lead 可寫**。builder 改驗收標準等同自己改考卷。

## 目錄

| 路徑 | 內容 |
|---|---|
| [LOOP-OPS.md](LOOP-OPS.md) | 作業手冊。所有 `§` 引用都指向這裡 |
| [refs/clay/](refs/clay/) | 參考圖 14 張。`car-park.png` 是**黃金樣本，最高權威** |
| [loop/](loop/) | 三方共享協定。見 [loop/README.md](loop/README.md) |
| [prompts/](prompts/) | LOOP-OPS §4 四份 prompt 樣板，可直接複製 |
| [progress/](progress/) | 監看儀表板 |
| `../ck-plumb/ARCHITECTURE.md` | 技術棧決策與三條硬性約束 |

## worktree

| 目錄 | 分支 | 工具 | 可寫範圍 |
|---|---|---|---|
| `../ck-physics` | `feat/physics` | Codex | `src/physics/`, `src/ai/`, `tools/telemetry/`, `tools/validate/` |
| `../ck-visual` | `feat/visual` | Claude Code | `src/render/`, `src/characters/`, `src/vfx/` |
| `../ck-plumb` | `feat/plumb` | Cursor | `src/ui/`, `src/loader/`, `build/` |

任何工具都可以**讀**其他 worktree，但只能**寫**自己的範圍。違反即在 review 時 revert。

## 下一步（W1 剩兩件，可並行）

骨架已完成，另外兩件的寫入範圍不重疊：

```bash
# Codex — 物理
cd ../ck-physics
# 取代 src/physics/world.ts 的 stub。固定 tick 迴圈、碰撞、封閉賽道 collider、圈數計時。
# 硬性約束：不得 import three、不得碰 DOM、不得讀 wall-clock、不得用未固定種子亂數

# Claude Code (Sonnet，不要開 Opus)
cd ../ck-visual
# 取代 src/render/renderer.ts 的 stub。方塊車 + 追尾相機（BAR-VISUAL §0.5：離水平面 12–18°）
```

**W1 不跑 loop。** 完成條件：一台車、一條封閉賽道、圈數計時、能開不卡。達成即進 W2。
這一波開 Opus 是純粹浪費。

## 監看

```bash
python3 -m http.server 8080   # 在 repo 根目錄
```

開 `http://localhost:8080/progress/`。
