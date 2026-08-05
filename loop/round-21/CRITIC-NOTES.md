# R21 視覺 critic —— 執行記錄與解碼

`VERDICT-visual.json` 的分數不是 critic 直接輸出的，是 **Lead 用標籤對照表解碼後**
寫成的。critic 不知道哪半邊是我們的（那正是盲測的意義），所以「我們得幾分」這件事
必須由持有對照表的一方換算。這份檔案記錄換算過程，讓那三個分數可以被獨立重算。

## 執行環境

- 工具：`codex-cli 0.144.5`，model `gpt-5.6-luna`，reasoning effort `xhigh`
- 隔離目錄：只放三個檔案——`BAR-VISUAL.md`（見下方「送交前的刪節」）、
  `contact-sheet.png`、`verdict.schema.json`
- **critic 看不到** repo 的 `loop/`、`tools/`、`refs/`、git 歷史，
  也看不到 `loop/round-2*/artifacts/` 底下我們自己的單張元件算繪圖
  （那些圖同樣足以反推哪半邊是我們的）
- 評的是 `loop/round-21/artifacts/contact-sheet.png`（R21 修好笑口之後的版本）

### 送交前的刪節

`BAR-VISUAL.md` 的 **§7 與 §7.1 已移除**才送給 critic。§7.1 是 R20 的參考半邊
裁決表，逐項列出每一組的來源檔案與裁切位置——照著讀完，哪半邊是參考一目了然，
盲測就不盲了。這是 `prompts/codex-visual-critic.md` 的執行前檢查沒有涵蓋到的第三條
外洩路徑（前兩條是「key 不在可讀路徑」與「檔名/EXIF 無線索」，兩條都是乾淨的）。
詳見 `loop/BACKLOG.md` 的對應條目。

## 標籤對照表如何取得

`contact-sheet.key.json` 被 `.gitignore` 排除，產生它的容器已經不存在，
所以這一輪的 key **不是從檔案讀來的，是重算的**。

`tools/visual/contact-sheet.mjs` 的打亂完全由 `mulberry32(seed)` 驅動，
與畫面內容無關：先用 Fisher-Yates 消耗 11 次 `rand()` 決定 12 組的排列，
再每組消耗 1 次決定左右。所以只要 manifest 的 `seed`（17）與元件順序沒變，
排列就可以完全重現。逐字照抄那三段（PRNG、洗牌迴圈、`refOnLeft` 抽樣）即可重算。

### 重算結果

| 格 | 元件 | 左 | 右 |
|---|---|---|---|
| r0c0 | drift-sparks | ref | ours |
| r0c1 | track-surface | ref | ours |
| r1c0 | track-barriers | ref | ours |
| r1c1 | skybox-lighting | ours | ref |
| r2c0 | water-sea | ours | ref |
| r2c1 | ui-hud | （暫緩，無 ref） | ours |
| r3c0 | shadows-contact | ref | ours |
| r3c1 | **kart-body** | **ours** | ref |
| r4c0 | **kart-wheels** | **ours** | ref |
| r4c1 | foliage | ours | ref |
| r5c0 | **driver-face** | **ours** | ref |
| r5c1 | item-boxes | ours | （暫緩，無 ref） |

### 這份 key 是對的，三條獨立證據

1. **兩格實圖目視核對**：裁出 r3c1 與 r5c0，左半都是 `§3` 規範的四視角中性灰
   算繪，右半都是參考照片——與表格一致
2. **兩個暫緩元件的位置**：critic 獨立回報 r2c1 與 r5c1「兩側都是佔位卡、平手」。
   R20 裁決暫緩的正是 `ui-hud` 與 `item-boxes`，key 把它們放在 r2c1 與 r5c1
3. **7 個已配對但未實作的元件**：critic 逐格指出哪一邊是佔位卡，**7 格全部**
   落在 key 標為 `ours` 的那一側。若 key 是錯的，7 格全中的機率是 1/128

## 兩次執行

第一次背景執行卡在 stdin 上，我誤判它已經死掉而重跑了一次；後來發現兩次都真的
跑完了（session `019fd1e7-3e5a` 與 `019fd1e8-ecfa`）。意外換到一次重複性檢查：

- **方向判斷三個已實作元件全部一致**——kart-body 認為參考那側較好、
  kart-wheels 認為我們這側較好、driver-face 認為參考那側較好
- 兩次的提示詞對 `actual` 的定義不同（第一次沒講清楚要記哪一張的分數，
  第二次明確要求「較差那一張」），所以兩份 JSON 的數字不能直接比。
  **`VERDICT-visual.json` 採用第二次**，因為只有它同時給出左右兩邊的分數，
  能跟 key 對起來換算出「我們得幾分」

## 解碼後的分數

`BAR-VISUAL §1` 的 PASS 門檻是**我們的輸出得分 ≥ 4**。

| 元件 | 我們 | 參考 | critic 認為較好的一邊 | 結果 |
|---|---:|---:|---|---|
| kart-body | **4** | 5 | 參考 | PASS |
| kart-wheels | **4** | 2 | **我們** | PASS（但見下方保留） |
| driver-face | **4** | 5 | 參考 | PASS |

critic 對三組的理由（原文）：

- r3c1 kart-body：「右側車體比例、分層與手捏質感更完整」
- r4c0 kart-wheels：「左側清楚呈現厚胎、奶油輪框與紅輪轂，右側主要是場景胎垛」
- r5c0 driver-face：「右側眼睛立體、笑口清楚且黏土層次更自然」

## 三項保留

1. **kart-wheels 這一組贏得沒有意義。** 我們拿 4、參考只拿 2，理由是參考半邊
   「主要是場景胎垛」——也就是那張裁切出來的參考本身撐不起 `§5.2` 的標準。
   `BAR-VISUAL §1` 把「critic 分不出來」視為最佳結果，但這一組不是分不出來，
   是**參考半邊比我們還差**。拿一個弱參考換到的 PASS 不構成品質證據，
   這組配對應該重新裁決（已記入 `BACKLOG`）
2. **driver-face 的 4 分是元件圖的分數，不是 `§5.3` 的驗收。** `§5.3` 明文寫著
   「裝到車上之後被引擎蓋擋住也算沒做到，元件圖看得到不構成通過」。contact sheet
   上的是 `§3` 四視角算繪，不是遊戲畫面。R21 那個修正的真正證據仍然是
   `artifacts/kart-front-zoom.png`，不是這個分數
3. **九個未實作元件的 1 分不是品質評價。** 那一半是空白佔位卡，critic 沒有東西
   可以評。`VERDICT-visual.json` 照實記 FAIL 而不是省略，是為了讓覆蓋率缺口
   在 verdict 裡看得見——但不要把它讀成「這九個做壞了」

## 結論

**不需要為了材質語言回頭修地基。** 已實作的三個元件全部達到 `§1` 的門檻，
`kart-body` 拿 4 而不是 2–3，材質地基本身是站得住的。剩下的九個元件可以照
`budget.json` 的順序往下做。
