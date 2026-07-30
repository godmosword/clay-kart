# clay-kart

黏土風格卡丁車競速遊戲。以三工具協作的 Gauntlet Loop 開發
（Claude Code / Codex / Cursor，三個獨立額度池分流）。

作業手冊：[LOOP-OPS.md](LOOP-OPS.md)

---

## 現在在哪

**W1（可玩骨架）尚未開始。** R0 bootstrap 已完成 —— 協調基礎就緒，尚無遊戲程式碼。

## 目錄

| 路徑 | 內容 |
|---|---|
| [LOOP-OPS.md](LOOP-OPS.md) | 作業手冊。所有 `§` 引用都指向這裡 |
| [BAR-FEEL.md](BAR-FEEL.md) | W2 手感驗收標準。**僅 Lead 可寫** |
| [BAR-VISUAL.md](BAR-VISUAL.md) | W3 視覺驗收標準。§5 待 Art Bible |
| [loop/](loop/) | 三方共享協定。見 [loop/README.md](loop/README.md) |
| [prompts/](prompts/) | LOOP-OPS §4 四份 prompt 樣板，可直接複製 |
| [progress/](progress/) | 監看儀表板 |

## worktree

| 目錄 | 分支 | 工具 | 可寫範圍 |
|---|---|---|---|
| `../ck-physics` | `feat/physics` | Codex | `src/physics/`, `src/ai/`, `tools/telemetry/`, `tools/validate/` |
| `../ck-visual` | `feat/visual` | Claude Code | `src/render/`, `src/characters/`, `src/vfx/` |
| `../ck-plumb` | `feat/plumb` | Cursor | `src/ui/`, `src/loader/`, `build/` |

任何工具都可以**讀**其他 worktree，但只能**寫**自己的範圍。違反即在 review 時 revert。

## 下一步（W1，三者可並行）

```bash
# Codex
cd ../ck-physics    # 貼 prompts/codex-telemetry.md 之前，先做 W1 物理迴圈

# Cursor
cd ../ck-plumb      # 專案骨架、build pipeline、dev server

# Claude Code (Sonnet)
cd ../ck-visual     # 最小可用渲染、一台方塊車
```

**W1 不跑 loop。** 目標只有「能開、不卡」，達成即進 W2。這一波開 Opus 是純粹浪費。

## 監看

```bash
python3 -m http.server 8080   # 在 repo 根目錄
```

開 `http://localhost:8080/progress/`。
