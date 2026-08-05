# clay-kart

黏土風格卡丁車競速遊戲。以三工具協作的 Gauntlet Loop 開發
（Claude Code / Codex / Cursor，三個獨立額度池分流）。

作業手冊：[LOOP-OPS.md](LOOP-OPS.md)

---

## 現在在哪

**W3 進行中（R20）。** 12 個視覺元件做了 3 個，黏土地基已接進遊戲畫面——
遊戲跑的不再是 W1 方塊車。

- **W1 完成。** 一台車、一條封閉賽道、圈數計時、鍵盤/觸控可駕駛
- **W2 以預算型停止收尾**，不是全項 PASS。`BAR-FEEL` 46 項中 42 項 PASS，
  硬門檻 `4.5` 過；`4.4`／`4.6`／`4.7`／`4.10`（drift 的次要項目）自 R5 起擱置，
  落差記在 [loop/BACKLOG.md](loop/BACKLOG.md)
- **W3 目前的兩個已知缺陷**（都是 R20 把畫面拍下來才發現的）：
  轉向在畫面上是反的、`driver-face` 裝上車後笑口被引擎蓋擋住。
  另外黏土管線的效能待優化，主導成本是 VSM 陰影而不是材質

> **W1 的驗證漏過了轉向方向。** 當時驗的是「送鍵盤事件後 yaw 真的改變」，
> 驗的是有沒有變，不是往哪邊變。這類缺陷只有把畫面跟輸入擺在一起看才會現形，
> 而畫面直到 R20 才第一次被拍下來（`tools/visual/game-shot.mjs`）。

素材來源是 `podcast-website` 的定義層，**已複製、不共用檔案**，兩個 repo 完全獨立。

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

## 下一步（R20 之後）

盲測 A/B 現在跑得起來了——`BAR-VISUAL §7.1` 的 12 組參考半邊已裁決（10 配對
2 暫緩），`§5.1–§5.12` 的個別條款也補齊了。已實作的 3 個元件**還沒有任何美術
分數**，這是 W3 至今最大的空白。

```bash
# 1) 先讓 critic 跑一次：3 個已實作元件的第一份 BAR-VISUAL 分數
node tools/visual/render-components.mjs     # 產我方半邊
node tools/visual/ref-tiles.mjs             # 產參考半邊（Lead 裁決的裁切）
node tools/visual/contact-sheet.mjs         # 12 格盲測圖，key 另存不進版控

# 2) 兩個 R20 發現的缺陷（各自一行到數十行，不在 Lead 寫入範圍）
#    - 轉向反向：src/physics/world.ts 或 src/ui/player-input.ts
#    - 笑口被擋：src/characters/driver-face.ts + components/kart.ts
```

**視覺 builder 才需要 Opus。** 裁決與接線用不到；剩下 9 個元件的美術工作才是
`LOOP-OPS §5` 說的 Opus + ultracode 檔位。

## 監看

```bash
python3 -m http.server 8080   # 在 repo 根目錄
```

開 `http://localhost:8080/progress/`。
