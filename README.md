# clay-kart

黏土風格卡丁車競速遊戲。以三工具協作的 Gauntlet Loop 開發
（Claude Code / Codex / Cursor，三個獨立額度池分流）。

作業手冊：[LOOP-OPS.md](LOOP-OPS.md)

---

## 現在在哪

**W1 完成，W2 即將開始。** 一台車、一條封閉賽道、圈數計時、鍵盤/觸控可駕駛——
全部經獨立驗證（不只是 typecheck/build，含用 CDP 對真實瀏覽器送鍵盤事件、
直接讀取模擬內部狀態確認轉向真的改變 yaw）。四個 worktree 同步在同一個 commit。

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

四個分支都已推上 `origin`。協調檔案寫在 `main`，程式碼寫在自己的 feature 分支，
遠端衝突規則見 [loop/README.md](loop/README.md)。

| 目錄 | 分支 | 工具 | 可寫範圍 |
|---|---|---|---|
| `../ck-physics` | `feat/physics` | Codex | `src/physics/`, `src/ai/`, `tools/telemetry/`, `tools/validate/` |
| `../ck-visual` | `feat/visual` | Claude Code | `src/render/`, `src/characters/`, `src/vfx/` |
| `../ck-plumb` | `feat/plumb` | Cursor | `src/ui/`, `src/loader/`, `build/` |

任何工具都可以**讀**其他 worktree，但只能**寫**自己的範圍。違反即在 review 時 revert。

## 下一步（W2 開場，Codex 一份任務做完，其餘等它）

```bash
cd ../ck-physics
# 讀 loop/round-3/TASK.md：telemetry + validator，W2 全波唯一需要做的基礎設施。
# 做完之後 W2 的 critic 成本降為零（Python 判 PASS/FAIL，不用 LLM）。
```

**這一波不要用 Opus。** 手感是數值調校不是創作，Sonnet 完全夠用，critic 免費，
可以放心跑很多輪（`LOOP-OPS §5`）。Cursor 和 Claude Code 在 telemetry/validator
做完前沒有 W2 的事可做。

## 監看

```bash
python3 -m http.server 8080   # 在 repo 根目錄
```

開 `http://localhost:8080/progress/`。
