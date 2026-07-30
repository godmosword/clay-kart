# BAR-VISUAL — 視覺標準

> W3 的唯一真實來源。Codex 盲測 critic（LOOP-OPS §4.3）讀這份文件評分。
>
> **狀態：骨架完成，美學條款待補。**
> §1–§3 的流程與 §4 的元件清單已定案，可直接使用。
> §5 各元件的黏土美學條款需要 Art Bible 才能填寫 —— 見文末 §7。

---

## §1 評分方式

Critic 收到一張 contact sheet，12 組並排圖，每組左右各一張：
一張來自 `refs/clay/`，一張是我們的輸出，**順序已隨機打亂**。

對每一組：
1. 判斷哪一張較符合本文件的黏土標準
2. 給我們那張 1–5 分（critic 不知道哪張是我們的，因此對兩張都評分）

**PASS 門檻：** 該元件我們的輸出得分 ≥ 4，且 critic 在 12 組中對該組的偏好判斷不一致（= 分不出來）視為最佳結果。

**標籤對照表 `loop/round-{N}/artifacts/contact-sheet.key.json` 絕對不得進入 critic 的可讀範圍。**
生成腳本必須把 key 寫到 critic prompt 讀不到的位置，且檔名不得出現在 contact sheet 的 EXIF 或檔案名稱中。

## §2 評分尺度

| 分數 | 意義 |
|---|---|
| 5 | 與參考無法區分 |
| 4 | 明顯同一套美學，細節有差距 |
| 3 | 方向對，但材質或比例可辨識為不同來源 |
| 2 | 只有形狀對，材質完全不同 |
| 1 | 不像黏土 |

## §3 拍攝規範（builder 產圖時遵守）

所有元件圖必須在同一組條件下渲染，否則評分不可比：

| 項目 | 規範 |
|---|---|
| 角度 | 四角度正交：front / 3-4 front-left / side / top |
| 解析度 | 每格 512×512，contact sheet 2048×3072 |
| 光照 | `refs/lighting/neutral-3point.json`，禁止逐元件調光 |
| 背景 | `#8a8a8a` 中性灰，無漸層 |
| 後製 | 禁止。無 bloom、無 color grade、無 AO 強化 |

## §4 元件清單（12 項）

W3 的 loop 對象。**先全部做到「堪用」再開始 loop**（LOOP-OPS §5）。

| # | 元件 | 範圍 | worktree |
|---|---|---|---|
| 1 | kart-body | 車身主體 mesh + 材質 | ck-visual |
| 2 | kart-wheels | 輪胎、輪框、形變 | ck-visual |
| 3 | driver-character | 駕駛角色 mesh + 材質 | ck-visual |
| 4 | track-surface | 賽道路面材質與接縫 | ck-visual |
| 5 | track-barriers | 護欄、路緣石 | ck-visual |
| 6 | foliage | 樹木、草叢 | ck-visual |
| 7 | skybox-lighting | 天空盒與全域光照 | ck-visual |
| 8 | drift-sparks | 漂移火花 VFX | ck-visual |
| 9 | item-boxes | 道具箱與拾取特效 | ck-visual |
| 10 | shadows-contact | 接觸陰影與 AO | ck-visual |
| 11 | water-hazard | 水面/危險區材質 | ck-visual |
| 12 | ui-hud | HUD 元素的黏土化處理 | ck-plumb |

## §5 各元件美學條款

> **待補 —— 需要 Art Bible。**
>
> 每個元件需填寫：材質條款（表面粗糙度、指紋/工具痕、邊緣圓角半徑）、
> 色彩條款（飽和度上下限、色溫）、比例條款（誇張化程度）、
> 以及一句「一眼判斷」的檢查句。
>
> 在填寫前，W3 的 critic 只能對 §3 拍攝規範與 §2 的整體印象評分，
> 無法給出可行動的 largest_gap。**不要在此節完成前啟動 W3 loop。**

## §6 全域禁令（現在就生效）

不需 Art Bible 也能確立的硬性條款：

- 禁止 PBR 金屬感。`metallic` 一律為 0
- 禁止鏡面高光銳點。`roughness` 下限 0.45
- 禁止硬邊。所有可見邊緣須有倒角，半徑 ≥ 該元件最短邊的 1.5%
- 禁止程序化雜訊直接當表面細節（會產生塑膠感而非黏土感）
- 禁止純黑 `#000000` 與純白 `#ffffff`

## §7 解除封鎖此文件所需

1. Art Bible（黏土風格的參考圖集與美學論述）
2. `refs/clay/` 至少 12 張參考圖，與 §4 元件一一對應
3. `refs/lighting/neutral-3point.json` 光照設定

三者齊備後，由 Lead 在 claude.ai 對話中產出 §5，不要交給 builder 自行定義
—— builder 定義驗收標準等同自己改考卷。
