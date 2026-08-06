# R24 視覺 critic —— 執行記錄與解碼

第二次真的跑起來的視覺 critic（第一次是 R21）。跟 R21 一樣，`VERDICT-visual.json`
的分數不是 critic 直接輸出的，是 **Lead 用標籤對照表解碼後**寫成的——critic
不知道哪半邊是我們的，「我們得幾分」必須由持有對照表的一方換算。

## 執行環境

- 工具：`codex-cli 0.144.5`，model `gpt-5.6-luna`，reasoning effort `xhigh`
- 隔離目錄只放三個檔案：`BAR-VISUAL.md`（**已刪去 §7 與 §7.1**）、
  `contact-sheet.png`、`verdict.schema.json`
- critic 看不到 `loop/`、`tools/`、`refs/`、git 歷史，也看不到我們自己的單張
  元件算繪圖
- §7／§7.1 為什麼要刪：那是 R20 的參考半邊裁決表，逐項列出每一組的來源檔案與
  裁切位置，照著讀完盲測就不盲了。詳見 `loop/BACKLOG.md`

## 標籤對照表

這次 `contact-sheet.key.json` 是現成的（R21 那次產生它的容器已消失，只能用
`mulberry32` 重算）。**兩者逐格完全一致**——回頭確認了 R21 那次的重建是對的。

| 格 | 元件 | 左 | 右 |
|---|---|---|---|
| r0c0 | drift-sparks | ref | ours |
| r0c1 | **track-surface** | ref | **ours** |
| r1c0 | track-barriers | ref | ours |
| r1c1 | skybox-lighting | ours | ref |
| r2c0 | water-sea | ours | ref |
| r2c1 | ui-hud | （暫緩） | ours |
| r3c0 | shadows-contact | ref | ours |
| r3c1 | **kart-body** | **ours** | ref |
| r4c0 | **kart-wheels** | **ours** | ref |
| r4c1 | foliage | ours | ref |
| r5c0 | **driver-face** | **ours** | ref |
| r5c1 | item-boxes | ours | （暫緩） |

## 解碼後的分數

`BAR-VISUAL §1` 的 PASS 門檻是**我們的輸出得分 ≥ 4**。

| 元件 | 我們 | 參考 | critic 偏好 | R21 我們 | 結果 |
|---|---:|---:|---|---:|---|
| kart-wheels | **4** | 4 | 參考略優 | 4 | PASS |
| kart-body | **3** | 4 | 參考 | 4 | FAIL |
| driver-face | **3** | 4 | 參考 | 4 | FAIL |
| track-surface | **3** | 2 | **我們** | 未實作 | FAIL |

critic 的理由（原文）：

- r0c1 track-surface：「右側較接近簡化黏土路面，左側仍明顯像柏油。」
- r3c1 kart-body：「右側車體的黏土紋理、色彩與場景一致性更好。」
- r4c0 kart-wheels：「右側輪胎的黏土表面與形變層次略完整。」
- r5c0 driver-face：「右側具更誇張的圓眼、清楚笑口與細緻黏土紋理。」

## 三項必須跟分數一起讀的保留

### 1. critic 的單輪變異大於 PASS/FAIL 的間距

**同一張參考圖在 R21 拿 2 分、R24 拿 4 分。** `kart-wheels` 的參考半邊
（`小紅賽車.jpg` 右側胎堆）兩輪之間只有重取樣等級的差異——逐位元比對，
取樣 112,348 個位元組，最大差 86、相異位元組平均 9.55，是不同機器上
`sharp` 重新編碼造成的，內容是同一張圖。

門檻是「≥ 4」，而同一個輸入的評分擺盪了 2 分。**這代表單輪 critic 分數
不足以當作 PASS/FAIL 的閘門。** 相對穩定的是**偏好方向**：`kart-body` 與
`driver-face` 兩輪都判參考較優，那個訊號一致。

### 2. `kart-body` 與 `driver-face` 從 4 掉到 3，但有兩個混淆因素

- **critic 變異**（見上，已量化為 ±2）
- **算繪機器不同**：R21 的圖是容器裡 SwiftShader 軟體算繪的，R24 是 M4 的
  真 GPU。同一份程式碼在兩台機器上算出來的像素本來就不同——這也是為什麼
  本輪驗證「三個既有元件零回歸」時，基準是**同一台機器上改動前的版本**
  （逐位元完全相同），而不是 R21 的產物

兩個因素都無法從現有資料切開。**不應把「掉一分」讀成造型退步。**

### 3. `track-surface` 是第三組參考半邊撐不起標準的配對

我們 3 分、參考 2 分，critic 主動指出「左側仍明顯像柏油」——而
`BAR-VISUAL §5.4` 明文寫著：

> **不用柏油灰**：黃金樣本的路面就是奶油沙色，柏油在黏土世界裡沒有出處。

也就是說，**這一組的參考半邊本身違反了它要代表的那一條**。這是同一類問題
第三次出現：

| 元件 | 參考半邊的問題 | 發現於 |
|---|---|---|
| item-boxes | 唯一候選有鏡面反光，違反 §6 | R20（事前排除，暫緩） |
| kart-wheels | 是場景胎垛，撐不起 §5.2 的分件要求 | R21 |
| **track-surface** | **是柏油灰，違反 §5.4 明文** | **R24** |

`§7.1` 的判準第 1 條寫著「參考半邊本身就是標準」。前兩次是事後才發現，
這次是 critic 自己指出來的。

## 這輪不能得出的結論

- **不能說 `track-surface` 沒做好。** 它贏了自己的參考，而那個參考違反
  `§5.4`。這一組的分數在配對修正之前沒有意義
- **不能說材質地基退步了。** 見保留 2
- **不能說 `kart-wheels` 通過了。** 4 分是在 critic 變異 ±2 的前提下拿到的，
  而且它的參考半邊在 R21 已被記為撐不起標準

唯一穩健的結論是**偏好方向**：`kart-body` 與 `driver-face` 兩輪都被判為
略遜於參考。那是可以拿去改的訊號，分數本身不是。
