# R33 給 Cursor 第二件（ck-plumb）

## 先讀邊界

`loop/README.md` 的「Builder 的邊界」是 R33 新增的，**四條全部對應上一件任務
實際發生的事**。三十秒讀完再開工，重點：

- **只 commit 到 `feat/plumb`。`main` 只有 Lead 能寫**，`progress/*.json` 也是
- **`loop/BACKLOG.md` 等裁決紀錄不要動**——實測值寫進回報，Lead 轉錄
- **不要 `reset` 分支**，尤其不要 reset 回 `origin/feat/plumb`。
  Lead 同步過的 worktree 是刻意的，退回去就是在舊樹上開工
- **註解跟你量到的數字衝突時，改註解**

上一件任務四條踩了三條。都不是災難，程式碼本身是對的、我驗過了，
但每一條都花掉了收尾時間。

---

## 任務零（先做這個，前面的分析被它推翻了）：`scene-stats` 沒攔 instanced draw

`sceneProbeScript()` 只覆寫了兩個進入點：

```js
prototype.drawElements
prototype.drawArrays
```

**而 `InstancedMesh` 走的是 `drawElementsInstanced`／`drawArraysInstanced`。**
所以每一個 instanced 物件對 `draw_calls` 與 `triangles_k` 的貢獻都是**零**。

怎麼發現的：我把葉瓣段數從 6 改成 10（面數 +67%，1440 片），重跑 `scene-stats`，
`triangles_k` **精確地還是 61.658**，跟 R32 記的一模一樣。

我補攔了那兩個進入點之後，同一個 build、同一個場景：

| | 現行 | 補攔之後 | 預算 |
|---|---|---|---|
| `draw_calls` | 142 | **168** | 150 → **超標** |
| `triangles_k` | 61.658 | **1617.722** | 400 → **超標 4 倍** |

`foliage.ts` 的註解自己寫著「所以每一樣東西都必須是 `InstancedMesh`」——
**元件做得越對，對量測就越隱形。**

### 要求

1. 攔 `drawElementsInstanced` 與 `drawArraysInstanced`，三角形數是
   `count / 3 × primCount`。兩個進入點在舊瀏覽器上可能不存在，取用前先判斷。
2. **修好之後不要動場景去讓它回到預算內**——那是 `src/render/`，我的範圍。
   如實回報超標值，我來處理。`scene-stats` 本來就是「超標只回報不修」。
3. 回報 `1617.722` 的**組成**：是不是陰影 pass 重複算繪同一批 instance？
   純幾何算術估整個場景 foliage 約 251k，差 6 倍，那 6 倍要有解釋。
   建議按 `mode`／呼叫次數分組印出來。

> 這條下面那個「漂移偵測」的任務**照做**，但基準要用修好之後的數字。
> 拿一個看不見最大貢獻者的數字去建基準沒有意義。

---

## 任務一：`scene-stats` 要報「相對上一輪的漂移」，不是只報絕對值對窗口

### 為什麼

R33 我重跑完整探針，量到 `draw_calls = 148`，窗口 `[0, 150]`。
而 R32 收尾記的是 `scene-stats 142`／完整 probe `140`。

**沒有人改 draw call，它自己漂了 +6～+8，而且沒有任何機制會注意到。**

> 註：`148` 這個數字本身也是瞎的（見任務零，真值 168）。但「漂移沒人看得見」
> 這件事不因此改變——修好探針之後它照樣會漂，而且從更高的起點漂。

這是同一個形狀的第三例：

| | 實測 | 上限 | 餘裕 |
|---|---|---|---|
| `BAR-FEEL §4.10` | 0.9697186 | 0.97 | **0.03%** |
| `ui-hud` 底板短邊比 | 0.107 | 0.11 | 2.7%（R28 才拉開，之前 0.7%） |
| `draw_calls` | 148 | 150 | **1.3%** |

三次都是「能過，但多加一個東西就靜靜推出去」。而 `scene-stats` 這支腳本
**本來就是你為了「增減場景時回報 draw_calls」而加的**（`eb983e5`）——
它現在只回報當下值，剛好漏掉它最該抓的那件事。

### 要求

1. **落盤一份基準**：`scene-stats` 跑完把結果寫成一個 committed 的 JSON
   （路徑你定，建議 `tools/visual/scene-stats.baseline.json`）。
2. **下次跑時比對並報漂移**：輸出要同時有絕對值、基準值、差值。
3. **漂移超過門檻就非零退出**。門檻建議 `draw_calls` ±5、`triangles_k` ±10%，
   數字你定但要寫清楚理由。**這條的重點是會失敗**——只印不擋等於沒有。
4. **基準要能明確更新**：加一個 `--update-baseline` 之類的旗標。
   場景真的長大了是正常的，但那要是一個**有人按下去的動作**，不是靜靜發生。
5. 掛進 `npm run test:plumb`。

### 不要做的事

- **不要為了讓 148 變小去改場景**。那是 `src/render/`，不在你範圍，
  而且現在還沒超標。這一輪只做「看得見漂移」，不做「把漂移壓回去」。
- 不要動 `BAR-PERF.md` 的窗口。

### 一件要順帶回報的事

跑第一次基準時，如果你量到的 `draw_calls` **不是** 148，把你量到的值回報。
我在 SwiftShader、6.3fps 的機器上量的，這個數字有沒有機器相依性我不知道
——如果它會變，那「漂移門檻」本身要重新設計，先講比事後發現好。

---

## 交件

- push 到 `feat/plumb`，回報 commit sha
- 回報實測的 baseline 數字與漂移門檻，不要只寫 PASS
- 回報動過的檔案清單

---

## 任務二（R33 追加，一行的事）：`bootstrap.ts` 沒接 `?totalLaps=`

`BAR-PERF §5.2` 要連續五圈，而比賽總長是 3 圈（`world.ts` 的 `TOTAL_LAPS`），
所以它**從寫下來那天起就不可能通過**。

Codex 已經把它範圍內的兩半做完了：

- `world.ts` 加了選用的 `WorldOptions.totalLaps`（預設仍是 3，非正整數丟 `RangeError`）
- `perf-probe.mjs:1054` 送 `?perfHeap=1&totalLaps=5`

**中間那一段在你家**：`src/loader/bootstrap.ts` 沒有讀 `totalLaps` 這個 query
參數，所以那個 5 到不了 `createWorld()`，實測仍是 `completedLaps: 3 / targetLaps: 5`。

### 要求

跟你 R33 做 `?solo=1` **完全同一個形狀**——在 `resolveAiOpponents()` 旁邊加一個
讀 `totalLaps` 的函式，傳進 `createWorld()`。

- 只接受正整數，非法值**忽略並沿用預設**（不要丟例外炸掉遊戲，這是玩家路徑）
- 不帶參數時行為完全不變（總圈數 3）
- 不要動 `world.ts`／`perf-probe.mjs`（Codex 的範圍，已經做好了）

### 回報

跑一次 `node tools/telemetry/perf-probe.mjs`，回報 `laps_measured` 有沒有變成 5、
以及 `heap_growth_per_lap_mb` 量到什麼。**那個值可能是 FAIL，沒關係**——
這一輪的目的是讓 `§5.2` 變成一個能通過也能失敗的檢查，不是讓它通過。
