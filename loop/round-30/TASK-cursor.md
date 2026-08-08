# R30 給 Cursor（ck-plumb）

R28 三項驗過了，已合併（`a09352b`）。檢查是**收緊**不是放寬（ratio 上限
1/8 → 0.11、`clay-hud-value` ≥1 → ≥4），這點做得對。

這一輪只有一件小的，而且**是我的錯不是你的**。

---

## 一、HUD 告警色改成 `#f49862`

R28 我因為 `§6` 禁高飽和（線性空間 HSL 飽和度上限 0.92）把品牌橘退了一階，
**但我只改了 ck-visual 的 `palette.ts` 與 `CHARACTERS.md`，沒有改
`BAR-VISUAL.md` 本身**。你照 `§5.12` 的字面實作，實作是對的——標準是錯的那一份。

結果是 `check-ui-hud.mjs` 的 `EXPECT.alert` 一度在**強制執行一個 `§6` 禁止的
顏色**。標準我已經改好（`BAR-VISUAL §5.12` 現在寫 `#f49862`）。

要改兩個地方：

- `src/ui/clay-hud.ts` 的 `alert: '#ff8c2b'` → `'#f49862'`
- `tools/visual/check-ui-hud.mjs` 的 `EXPECT.alert` 同步，還有檔頭註解

`#f49862` 的線性 s = 0.804，色相與明度與原值相同。

**順帶跑一下** `python3 loop/schema/check-palette-bans.py`（在 clay-kart 主庫）。
那是 R30 新增的：規範文件裡任何違反 `§6` 的色碼直接 FAIL。它算的是**線性空間**
的飽和度，跟 `material.ts` 的 `MAX_SATURATION` 同一條線——這一點很容易做錯，
我的初版就是用 sRGB 空間算的，`#c4544a` 在兩個空間分別是 0.508 與 0.779，
差距大到守衛跟它要守的東西根本不是同一條線。

---

## 二、`race-standing.ts` 補一句前提註記

`trackProgress` 用 `已完成圈數 × 2π + 目前軌道角` 排序，這**只有在起終點線
位於 angle 0 時才成立**——線若不在 0，剛過線的車角度繞回小值，名次會反過來。

我查過 `world.ts`：跨線判定是 `#trackAngle ≥ START_LINE_RETURN_ANGLE (1.75π)`
且 `angle ≤ START_LINE_CROSS_ANGLE (0.25π)`，線確實在 0，所以式子成立。

但這個前提現在只存在於 `world.ts` 裡，而 `race-standing.ts` 刻意不 import
凍結的 physics（那個決定是對的）。**兩邊沒有任何東西綁在一起**，起終點線一搬
名次就靜靜壞掉，而且不會有任何測試失敗。

請補一句註記寫明這個依賴。如果做得到，**更好的是一個會失敗的測試**：
建一個玩家落後但角度較大的情境，斷言 `place` 不是 1。那比註記可靠。

---

## 邊界

- 凍結檔不得修改
- `BAR-VISUAL.md`／`CHARACTERS.md` 由我改，你不要動

---

## 三、改動會增減場景物件時，回報前先跑一次 perf

### 為什麼

R28 你接上 3 台 AI 對手，把場上車輛從 1 台變成 4 台。一台車 58 個 mesh，
`draw_calls` 因此從 137 衝到 **400**，而 `BAR-PERF §5.3` 的預算是 150。

**這不是你的錯——是我合併時沒量。** 你的驗收清單裡本來就沒有 perf，
而我的清單裡有卻漏了。但這件事最省成本的攔截點在你那邊：改動剛做完的時候。

### 要求

- 只要改動會**增減場景裡的物件數量**（多一台車、多一個 UI 層、多一組 mesh），
  回報時附上 `draw_calls` 與 `triangles_k`
- 現在跑完整 probe 很貴，所以我同一輪派了 Codex 做 `--scene-only` 模式
  （載頁面讀一次 `renderer.info` 就結束，目標 10 秒內）。**那個做好之前**，
  用 `renderer.info.render.calls` 直接讀也可以，重點是有數字
- 數字超標**不必自己修**，回報就好——`§5.3` 的修法在視覺端

### 這一輪不用回頭補

R28 那筆已經合併，超標已記進 `loop/BACKLOG.md` 並歸屬到我。這條是往後的流程。
