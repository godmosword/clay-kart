# R17 — W3 前置：contact sheet 生成腳本

**Wave:** W3 前置（`loop/PLAN.md` W3 表格第 1 項、`BAR-VISUAL.md §1`/§3）
**Owner:** Cursor（`../ck-plumb`，分支 `feat/plumb`）
**前一輪（plumb）:** R8——drift 輸入鍵接線，`progress/plumb.json` 顯示
`status: done`，已確認 typecheck/test/build PASS。

---

## 背景

W3 視覺 builder（Claude Code，Opus + ultracode）即將開工，`ck-visual`
會依 `BAR-VISUAL.md §4` 的 12 個元件陸續產出四角度 512×512 渲染圖
（`BAR-VISUAL.md §3` 拍攝規範：front / 3-4 front-left / side / top，
背景 `#8a8a8a` 中性灰）。Codex 的盲測 A/B critic（`LOOP-OPS.md §4.3`）
需要一張 contact sheet：12 組並排圖，每組左右各一張——一張來自
`refs/clay/`，一張是我們的輸出，**順序隨機打亂**，critic 不知道哪張
是哪張。

這是 `PLAN.md` W3 表格明確指派給你的第一步，在視覺 builder 開始產圖
之前就該有這支腳本準備好。

## 這輪要做什麼

寫一支腳本（放哪裡你決定——`src/loader/`、`build/`，或新開一個
`tools/visual/` 之類的路徑都可以，這個任務是 `PLAN.md` 明確指派給你的，
不受一般 `tools/telemetry/`／`tools/validate/` 屬於 Codex 的慣例限制），
輸入是：

- `ck-visual` 每個元件產出的四角度渲染圖（產出路徑格式你可以先跟這輪
  的假設對齊，或先用假圖跑通流程——視覺 builder 目前還沒真的產圖，
  這輪你可能要先用 placeholder 圖驗證腳本本身能動）
- `refs/clay/` 現有的參考圖

輸出：

- `loop/round-{N}/artifacts/contact-sheet.png`——2048×3072，12 組並排，
  每組左右各一張，**隨機打亂**
- `loop/round-{N}/artifacts/contact-sheet.key.json`——哪一格是哪一張的
  對照表，**這個檔案絕對不能被 critic 讀到**：不能出現在 contact sheet
  本身的 EXIF、檔名，也不能被 critic 的 prompt 存取路徑碰到。
  `.gitignore` 已經排除 `*.key.json`，這條你不用加，但腳本本身的存放
  邏輯要確保這個檔案不會被意外打包進任何 critic 讀得到的目錄

## 有一個需要你判斷、可能要停下來寫 BACKLOG 的地方

`refs/clay/` 目前只有 8 張圖（`car-park.png`／`dino.png`／`rescue.png`／
`ocean.png`／`sea.png`／`cloud-a/b/c.png`／`characters/*.jpg`），但
`BAR-VISUAL.md §4` 的元件有 12 項（`kart-body`／`kart-wheels`／
`driver-face`／`track-surface`／`track-barriers`／`foliage`／
`skybox-lighting`／`drift-sparks`／`item-boxes`／`shadows-contact`／
`water-sea`／`ui-hud`）。沒有現成的「每個元件各一張對應參考圖」——
`car-park.png` 這類是整個場景的合成圖，可能同時包含好幾個元件（車身、
地面、護欄……都在同一張裡）。

**這是設計判斷，不是機械性工作**：要嘛從既有的合成參考圖裡裁切出跟
某元件相關的區域當該組的參考半邊，要嘛某些元件（例如 `drift-sparks`、
`item-boxes` 這種上游素材庫可能沒有的東西）暫時沒有對應參考圖、那一組
先跳過或標記待補。**照 `LOOP-OPS.md §4.4` 的規則：這種需要判斷「要不要
這樣做、哪個方案比較好」的情況，停下來寫進 `loop/BACKLOG.md`，不要
自己決定**——12 組要湊齊怎麼配對，我來裁決。你可以先把腳本的機制
（隨機打亂、key 隔離、輸出格式）做完整、跑得動，用你能取得的圖（哪怕
只有 5-6 組真的能配對）先驗證通過，缺口部分寫清楚缺什麼。

## 完成的定義

- [ ] 腳本能吃輸入圖、產出 `contact-sheet.png` + `contact-sheet.key.json`
- [ ] 打亂順序是真的隨機（不是固定 pattern，每次跑可能不同——但整體
      流程要決定性可重跑，種子你決定放哪裡）
- [ ] `key.json` 不會被打包進任何 critic 存取路徑，驗證方式你自己想
      （例如檢查 contact sheet PNG 的 EXIF 沒有殘留路徑資訊）
- [ ] 12 組配對哪些目前湊得齊、哪些湊不齊，在 BACKLOG 寫清楚
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0（若腳本本身是
      TypeScript／需要納入型別檢查）
- [ ] 結束前更新 `progress/plumb.json`

## 這輪不做什麼

- 不產視覺內容本身——那是 Claude Code（Opus+ultracode）的工作
- 不做評分邏輯——那是 Codex 的盲測 critic
- 不用猜的方式硬湊 12 組配對——湊不齊就照實寫進 BACKLOG

## 實作方式由你決定

腳本語言、放在哪個路徑、怎麼裁切/配對現有參考圖——都你決定，除了上面
點名「要不要湊、怎麼湊」那個判斷要停下來問。
