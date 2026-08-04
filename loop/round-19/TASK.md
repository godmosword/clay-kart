# R19 — W3：`kart-wheels` + `driver-face`

**Wave:** W3
**Element:** `kart-wheels`（cap 300000）+ `driver-face`（cap 500000）
**Owner:** Claude Code（`../ck-visual`，分支 `feat/visual`）
**前一輪:** R18——W3 視覺地基（黏土材質／全域光照／`§3` 拍攝台／輪廓擠出）
＋ `kart-body`，已獨立驗證並合併進 main（`4bb0beb`）。

---

## 為什麼挑這兩個

它們跟 `kart-body` 是同一台車。地基宣稱「全 12 元件共用一套材質語言」，
但只做過一個元件的話那還只是宣稱——同車的三個元件擺在一起，材質尺度、
配色、壓痕密度對不對得上是**一眼可驗**的，比再多做一個不相干的元件更快
證實或推翻地基。

## 這輪做了什麼

**`kart-wheels`（`src/render/components/kart-wheels.ts`）**
厚實圓環胎面 + 兩側奶油輪框 + 紅色輪轂，尺寸讓輪軸落在 `y=0.36`，對齊
`kart-body` 擋泥板的位置。`CHARACTERS.md §4` 要「輪子大而圓」，所以胎厚
給得很足。「形變」用承重造成的接地側微扁表現，是造型暗示不是物理模擬。

審查用單顆（`createKartWheel`），遊戲用四顆組（`createKartWheelSet`）——
一顆放大才看得到胎面與壓痕，四顆排開每顆都太小。

**`driver-face`（`src/characters/driver-face.ts`）**
臉盤 + 大圓眼（眼白／虹膜／瞳孔／眼神光四層壓上去）+ 笑口 + 舌頭。

眼球做成接近半球而非貼平圓片：`CHARACTERS.md §4` 要求「**任何角度都要
看得到眼睛**」，貼平的眼睛側視就消失了。第一版 z 縮放 0.72 側視幾乎只剩
臉盤邊緣，改成 0.95 後側視也看得到眼球。

## 目錄分界（依 `CHARACTERS.md §3`，不是分類潔癖）

§3 的判準是「凡是由 `SimSnapshot` 驅動的，60fps；凡是純表演的，12fps」，
且明文「輪子自轉、懸吊 → 60fps，屬載具，不是角色」。所以：

- 輪子 → `src/render/components/`（載具，60fps）
- 臉 → `src/characters/`（純表演，12fps）

§3 是「違反即整輪 FAIL」的規則。把兩種更新率的東西實體隔在不同目錄，
比只在註解裡提醒可靠。

`driver-face` 的 `setExpressionTime()` 內建 `floor(t * 12) / 12` 量化，
呼叫端傳原始時間即可——量化只實作一次，不會有某個呼叫點忘了抽格。
另附 `measureExpressionQuantisation()` 供之後 `BAR-PERF §4.1` 實測用。

## 這輪不做什麼

- **不接進遊戲 `renderer.ts`**——維持 R18 的狀態，`BAR-PERF` 量到的仍是
  W1 方塊車。接線是獨立的一步，會動到既有的多車繪製與相機，跟做元件
  混在同一輪會讓回歸來源分不清
- 不做其餘 9 個元件
- 不填 contact sheet 的 12 組配對（R17 BACKLOG，仍待裁決）

## 完成的定義

- [ ] 兩個元件產出 `§3` 規範圖，與 `kart-body` 材質語言一致
- [ ] `§6` 全域禁令稽核通過，且稽核 self-test 仍有效
- [ ] `npm run typecheck`、`npm run build` exit 0
- [ ] `perf-probe` 重跑無退化
- [ ] 收尾前跑 merge-base + worktree `git status` 雙重檢查
