# R33 給 Codex 第三件（ck-physics）—— 一件事，我需要數據才能裁決

上一件我獨立驗過了，**兩件都照規格做到**：

- `world.ts` 的 38 行只加了選用的 `totalLaps`，預設仍是 `TOTAL_LAPS = 3`，
  非正整數丟 `RangeError`，其餘全是機械替換。**FROZEN 開閘的條件達成**——
  我自己重跑 `ghost-replay` + `feel.py`：46/46 PASS，
  `§4.10 = 0.9697186325`，與 R22 到小數第七位相同，零回歸。
- instanced draw 攔起來了，而且 breakdown 的 `framebuffer` / `viewport` 欄位
  直接回答了我問的那個 6 倍。你量到的 `triangles_k = 1614.818` 與我獨立量到的
  `1617.722` 吻合。

`§5.2` 仍是 3/5 圈，但**不是你的問題**：`perf-probe.mjs:1054` 確實送了
`?totalLaps=5`，接線缺在 `src/loader/bootstrap.ts`——那是 Cursor 的檔，
已經開給它了。你範圍內的兩半都做完了。

---

## `§5.3`／`§5.4` 現在誠實地 FAIL 了，而我需要知道該修什麼

```
5.3  draw_calls     174.000  [0, 150]
5.4  triangles_k   1614.818  [0, 400]
```

**這兩個數字第一次是真的。** 但在我決定「去砍場景」還是「預算寫錯了」之前，
我需要把它拆開。

### 問題

`renderer.info.render` 這一類的計數把**所有 pass** 都算進去，包含陰影圖。
你的 breakdown 已經顯示 `framebuffer=fbo-1`、`viewport 512×512`——那是陰影圖，
每盞投影燈把全部 instanced 幾何重畫一次。

所以 `1614.818` 至少有兩種讀法：

| 讀法 | 若成立 | 該修什麼 |
|---|---|---|
| 主 pass 就超標 | 場景本身太重 | **我**去砍幾何／LOD（`src/render/`） |
| 主 pass 沒事，陰影 pass 灌爆 | 陰影設定太貴 | **我**去調陰影，或改預算的定義 |
| 預算本來就不含陰影 pass | 400 這個數字量的是別的東西 | **裁決**：`BAR-PERF §5.4` 要重寫 |

**三種的處置完全不同，而我從一個總和分不出來。**

### 要求

把 `draw_calls` 與 `triangles_k` 拆成**每幀、按 pass**：

1. **主 pass vs 離屏 pass 分開**。判準用 framebuffer 綁定（`fbo-0`／預設
   framebuffer 是主 pass，其餘是離屏），你已經有這個欄位了。
2. **每幀**，不是累計。現在 breakdown 的 `calls: 2156` 是整段量測窗口的總和，
   除不出單幀成本。
3. 陰影 pass 若不只一個（多盞燈／cascade），**分別列出**。
4. `metrics` 頂層仍然回報現行的總和（窗口比對的對象不變），拆解放在
   `meta` 或一個 `*_breakdown` 欄位裡。**不要改窗口，不要改總和的定義**
   ——那是我要裁決的事，不是這一輪。

### 明文禁止

- 不得為了讓 `5.3`／`5.4` 通過而排除任何 pass。**這一輪的目的是讓那個
  FAIL 可診斷，不是讓它消失。**
- 不得動 `src/render/`（我的範圍）。
- 不得動 `BAR-PERF.md` 的窗口。

### 回報

- 主 pass 每幀 `draw_calls` / `triangles_k`
- 每一個離屏 pass 每幀 `draw_calls` / `triangles_k`，附 framebuffer 與 viewport
- 兩者相加是否等於現行總和（**對不上就講，不要湊**）

---

## 順帶：你的分支需要重置

`feat/physics` 現在有 13 個 commit，其中 **7 個是我已發布 commit 的 rebase 複本**
（同標題不同 sha）。你真正的六個我已經 cherry-pick 進 main 並驗證完畢。

直接 merge 你的分支會讓 **11 個檔案從 main 消失**——整輪 R33 的證據
（三輪 critic 原文、`VERDICT-visual.json`、對比表、實景圖、提示詞）。
`tools/lead/integrate.mjs` 攔下來了，這是它第一次使用。

所以：**開工前先 `git fetch && git reset --hard origin/main`**（或等我 reset），
不要在現在這棵樹上疊東西。已發布的 commit 不要 rebase——見
`loop/README.md` 的「Builder 的邊界」第三條。

## 交件

- artifact 直接寫進 `loop/round-33/artifacts/` 並 commit（那是你該寫的位置）
- push 到 `feat/physics`，回報 commit sha 與實測數字
