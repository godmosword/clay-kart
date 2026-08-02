# R16 — 修 `perf-probe.mjs`：§4 防抽格檢查要真的量測渲染器，不是寫死常數

**Wave:** W2 收尾 / W3 前置（`BAR-PERF §4`，見 `loop/BACKLOG.md`「perf-probe.mjs
的 §4 防抽格檢查是寫死常數，永遠通過」條目）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R15 `bddf6ce`——修好橡皮筋機制，`ai-opponents` 的 §12 四項
指標全數真實 PASS。我獨立驗證屬實並合併進 main（`b28bd25`）。W2 的
`ai-opponents` 元件到此告一段落，這輪轉向一個擋在 W3 前面的舊缺口。

---

## 為什麼現在處理

`loop/BACKLOG.md` 從 R3 就記著這條，明講「必須在 W3 視覺 builder 開工前
解決」——我們現在正準備轉向 W3。`tools/telemetry/perf-probe.mjs` 目前：

```js
character_anim_hz: 12,
vehicle_transform_hz: 60,
camera_hz: 60,
```

這三個值直接寫死，從沒載入或量測過 `src/render/` 的任何東西。整支探針
其實是在 Node 裡跑純物理 tick（`advance()`），`fps_p50`/`fps_p05` 量的
是物理迴圈吞吐量（R3 實測 77 萬～120 萬），跟瀏覽器渲染幀率完全無關。
`BAR-PERF §4` 是全份文件裡少數標明「違反即整輪 FAIL，不論其他指標多好」
的檢查，優先序還排第一——現在這道防線是空的。W3 若不小心把整個 scene
抽格（`CHARACTERS.md §3` 點名最容易犯的錯：想做角色定格感，結果連
載具/相機一起抽格了），這三個檢查會照樣回報 PASS。

## 這輪要做什麼

用真的 headless browser（Playwright、raw CDP，或你評估後認為合適的
方案）載入 `build/out/`（`npm run build` 的產物），跑起來，量測**真實**
的 frame timing。方向：

- `npm run build` 產物需要一個方式驅動它跑起來並收集 timing——CDP 的
  `Performance`/`Tracing` domain，或注入一段腳本監聽
  `requestAnimationFrame`，都可能可行，你評估
- 用固定、決定性的驅動序列（例如沿用 `fixtures/lap-a.json` 的輸入），
  確保跑分可比，跟 `ghost-replay` 的方法論一致
- `fps_p50`/`fps_p05`/`frame_time_p99_ms`/`long_frame_count` 應該改成
  量測**真實瀏覽器**的 frame timing，不是物理 tick 吞吐量

**`vehicle_transform_hz`/`camera_hz` 現在就可以真的測**——`src/render/
renderer.ts` 的 `draw()` 每個 rAF 幀都更新車輛 transform 跟相機
position/lookAt，這是現有行為，不需要等 W3 才有東西可測。

**`character_anim_hz` 目前沒有東西可測**——`src/render/renderer.ts` 現在
只畫方塊車（R1 的 `#kartMeshes`），沒有任何角色 mesh 或抽格動畫邏輯。
**不要為了讓這項有數字而發明假的角色動畫或憑空回報 12**。這項現在該
誠實回報「不適用／尚無角色內容可測」，等 W3 真的做出角色動畫後再接上
真實量測——你判斷要用什麼狀態表示這個情況（例如 `null`、獨立的
`not_applicable` 標記，或維持窗口設計但讓 `feel.py`/`perf.py` 對應邏輯
知道要跳過而不是拿 12 這個寫死值去比對），不要讓它看起來像測過。

## 跨寫入範圍的提醒

如果你評估後發現，要真的量出 `vehicle_transform_hz`/`camera_hz`，
需要在 `src/render/renderer.ts`（我的寫入範圍）或 `src/loader/
bootstrap.ts`（Cursor 的寫入範圍）裡加一個穩定的 debug/telemetry hook
（類似之前 CDP 驗證用過的 `window.__DEBUG_WORLD__` 模式，但這次是要
long-term 留著的基礎設施，不是驗證完就 revert 的臨時手段）——**不要
自己動那些檔案**。把你需要的確切 hook 形狀（要暴露什麼欄位、什麼時機
更新）寫進 `loop/BACKLOG.md`，我來加，或協調對應工具加。如果你能純粹
從瀏覽器外部（CDP tracing、rAF 監聽）量到東西，不需要動 app 程式碼，
那就不用等，直接做。

## 完成的定義

- [ ] `perf-probe.mjs` 真的驅動一個 headless browser 跑 `build/out/`，
      不再是純 Node 物理迴圈代理
- [ ] `fps_p50`/`fps_p05`/`frame_time_p99_ms`/`long_frame_count` 量的是
      真實瀏覽器 frame timing
- [ ] `vehicle_transform_hz`/`camera_hz` 是從渲染器實際行為量出來的
      真數字，不是寫死值
- [ ] `character_anim_hz` 誠實回報「無角色內容可測」，不是憑空湊一個
      12
- [ ] `tools/validate/perf.py`（若這個檔案存在／需要新建）能正確處理
      「尚無法測量」的狀態，不要把它當成巧合通過的預設值
- [ ] 新的 `loop/round-16/VERDICT-perf.json`（或既有格式），標註
      `device: "proxy"`（`BAR-PERF §7` 要求，尚無真實裝置量測）
- [ ] `npm run typecheck`、`npm run build`、既有 pytest 全數通過（不要
      破壞 `feel.py` 既有測試）
- [ ] `loop/budget.json` 若有對應 ledger 需要新增或更新，如實記錄花費
- [ ] **收尾前自己跑一次 `loop/README.md` 的 merge-base 檢查**，回報
      commit hash 並標記 blocked 等 Lead 合併

## 這輪不做什麼

- 不做真實裝置（iPad/Android）量測——`BAR-PERF §7` 允許現階段用 proxy，
  真裝置留到有硬體時再說
- 不建立角色動畫內容——那是 W3 視覺 builder 的工作，這輪只確保「當
  角色動畫真的做出來時，有一個誠實的檢查在等著」
- 不動 `src/render/`／`src/loader/`——若需要新 hook，走上面「跨寫入
  範圍的提醒」流程

## 實作方式由你決定

用 Playwright 還是 raw CDP、怎麼收集 timing 資料、`character_anim_hz`
的「不適用」狀態怎麼表示——都你決定。
