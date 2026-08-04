# R18 — W3 視覺地基 + kart-body 端到端驗證

**Wave:** W3（第一輪）
**Element:** `kart-body`（cap 500000）+ 共用視覺地基
**Owner:** Claude Code（`../ck-visual`，分支 `feat/visual`，Opus + ultracode）
**前一輪:** R16（perf-probe §4 真實量測）、R17（contact sheet 腳本）皆已
獨立驗證並合併。W2 收尾完成，main 乾淨。

---

## 為什麼第一輪不是「做一個元件」而是「做地基」

`BAR-VISUAL §3` 自己讓這件事變成硬前提：

> 光照：柔和均勻漫射，依 §5.0。**禁止逐元件調光**
> 所有元件圖必須在同一組條件下渲染，否則評分不可比

12 個元件裡的 `skybox-lighting`（#7）就是全域光照本身。如果先做
`kart-body` 再做 #7，等於先在臨時光照下定了車身的材質判斷，之後全域光
一改，車身要重評——`§5.0` 的鐵律「全場維持同一套柔和均勻光」會被施工
順序本身違反。

第二個更直接的理由：`tools/visual/contact-sheet.manifest.json` 期待
`build/visual/kart-body.png` 這類產物，但**現在沒有任何東西會產生它**。
缺的是一個符合 `§3` 規範的 render harness。

所以這輪做三件共用基礎，再套一個元件證明管線真的通：

1. **黏土材質系統**——`§5.0` 的霧面油土、手捏邊倒角、指紋/工具壓痕、
   接縫。全 12 元件共用同一份，這是整個 W3 最高槓桿的一次美學決定
2. **全域光照鑽機**——`§5.0` 的柔和大面積弱方向主光 + 高均勻暖白環境光
   + 短柔低對比接地陰影
3. **Render harness**——`§3` 規範的四角度 512×512、`#8a8a8a` 背景、
   禁止後製，輸出到 `build/visual/`
4. 套到 `kart-body` 上端到端驗證

## 已解決的兩個規格張力（記錄裁決）

**一、`§3` 要四角度，但 contact sheet 每個元件只有一格 512×512。**
（`contact-sheet.mjs`：`CELL=512`、`2048 = 512×2×2`、`3072 = 512×6`，
12 組每組兩格。）裁決：兩者都產——四張獨立 512×512 供細看，另外合成一張
2×2 網格（每格 256×256）的 512×512 當 contact sheet 用的那一格。這樣
`§3` 的四角度要求與 contact sheet 的版面都滿足，不必改任何一邊的規格。

**二、`§5.0` 要 AO，但 `§3` 禁止「AO 強化」。**
裁決：材質/幾何層級的 AO（縫隙、接地淺淺一圈）算 `§5.0` 要的東西，
螢幕空間 AO 後處理才是 `§3` 禁的。不加 SSAO pass。

## 寫入範圍決定（Lead 裁決，需記錄）

`PLAN.md` 的寫入範圍表給 `ck-visual` 的是 `src/render/`、`src/characters/`、
`src/vfx/`。Render harness 的**驅動腳本**（headless Chrome + 截圖）不屬於
這三個路徑，而 `tools/visual/` 在 R17 已被 Cursor 用於 contact-sheet。

裁決：`tools/visual/` 改為 **W3 視覺工具共用目錄**，`ck-visual` 與
`ck-plumb` 皆可寫，但各自只擁有自己建立的檔案，不得改對方的。
理由：寫入範圍規則的目的是防止三個工具同時改同一個檔案，不是禁止在
同一個主題目錄下各自新增檔案。這條已同步更新 `loop/PLAN.md`。

渲染邏輯本身（場景、相機、材質、光照）仍全部留在 `src/render/`。

## 這輪不做什麼

- **不做其餘 11 個元件**——`LOOP-OPS §5` 的順序規則是「先全部堪用再
  loop」，但地基必須先於全部。這輪只證明地基能撐起一個元件
- **不填 contact sheet 的 12 組配對**——那擋的是 critic loop（第二
  階段），不擋這輪。而且等 `kart-body` 真的有圖，判斷「該配哪張參考
  半邊」會準得多
- **不補 `BAR-VISUAL §5.1–§5.12`**——文件自己寫了要等有實際產出再補
- **不做輪子（#2）、不做臉（#3）**——雖然參考圖上都在同一台車上，但那
  是獨立元件，這輪只做車身
- **不改 `src/physics/`、`src/loader/`、`tools/telemetry/`、
  `tools/validate/`**——別人的範圍

## 已知的結構性風險（記錄，不是這輪能解的）

W3 第一階段**完全沒有 critic**。過去 17 輪 Lead 都是審查者，靠獨立重跑
抓到多次假 PASS 與未合併的程式碼。這一輪起 Lead 同時是 builder，而
Codex 的盲測 critic 要到第二階段才啟動——中間是無人複核的美學判斷。
緩解方向（待裁決，不在這輪範圍）：用 contact-sheet 腳本讓 Lead 自己先
做一次不看標籤的並排比對；或提早讓 Codex 對前 2–3 個元件做早期 critic，
不等 12 個全做完。

`BAR-PERF §5.5 texture_memory_mb` 目前仍是 `null` 被正規化成 0 的假
PASS（見 BACKLOG），而 `BAR-PERF §8` 明講「W3 每輪跑全部，黏土材質是
效能主要風險」——這輪刻意只用**一張共用程序生成的黏土紋理**，不是每個
元件各自一張，正是為了讓材質記憶體從一開始就不會失控，但這不能取代
真正的量測。

## 完成的定義

- [ ] 黏土材質系統可被全部 12 元件共用，符合 `§6` 全域禁令
      （`metallic=0`、`roughness>=0.45`、無純黑純白、無高飽和、
      表面細節是有方向性/局部聚集的壓痕而非均勻 noise）
- [ ] 全域光照鑽機符合 `§5.0`，且**不允許逐元件覆寫**
- [ ] Render harness 產出 `§3` 規範的圖（四角度 + 2×2 合成格）
- [ ] `kart-body` 產出實際圖片，跟 `refs/clay/characters/小紅賽車.jpg`
      並排看得出是同一套美學
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `perf-probe` 重跑，`BAR-PERF §2`/`§4`/`§5` 不退化（尤其
      `vehicle_transform_hz`/`camera_hz` 不得被新的渲染工作拖到抽格）
- [ ] 更新 `progress/visual.json`
- [ ] 收尾前跑 `loop/README.md` 的 merge-base + worktree `git status`
      雙重檢查
