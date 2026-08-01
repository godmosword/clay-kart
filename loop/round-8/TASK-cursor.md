# R8 — Cursor：補上漂移按鍵，玩家現在完全觸發不了漂移

**Owner:** Cursor（`../ck-plumb`，分支 `feat/plumb`）
**可寫路徑:** `src/ui/`、`src/loader/`、`build/`、`package.json`

---

## 這是真落差，不是例行檢查

`WorldInput.drift` 從 R3（`src/contract/sim.ts`）就存在，Codex 從 R4 到 R6
花了三輪、超過 120 萬 token 調漂移與 mini-turbo 的手感（`BAR-FEEL §4`，
`4.5` 還是全份文件唯一的硬門檻指標，已經通過）。

**但 `src/ui/player-input.ts` 的 `KEY_TO_ACTION` 和 `TOUCH_BUTTONS` 裡
從來沒有 `drift` 這個動作。** 現在把 `npm run dev` 開起來，不管怎麼按
鍵盤或點觸控按鈕，車子都不會進入漂移狀態——`poll()` 回傳的 `WorldInput`
永遠沒有 `drift: true`。三輪物理調校完全沒有對應的輸入路徑可以觸發。

---

## 要做的

1. **鍵盤：** `KEY_TO_ACTION` 加一個 `drift` 動作，綁一個容易跟 WASD/方向鍵
   同時按的鍵（現有鍵位：`ArrowUp/W`=throttle、`ArrowDown/S`=brake、
   `ArrowLeft/A`=steerLeft、`ArrowRight/D`=steerRight、`Shift`=reverse、
   `Space`=jump）。選哪個鍵你決定，但要能跟轉向鍵同時按住（漂移需要
   `drift && |steer|>0` 才會進入，見 `BAR-FEEL §4` 的輸入機制說明）。

2. **觸控：** `TOUCH_BUTTONS` 加一個 `drift` 按鈕。目前 6 顆按鈕在
   `left`/`right` 兩個 zone，版面你自己排，記得受眾是 3–7 歲兒童
   （`CHARACTERS.md §1`），按鈕別太小太密。

3. **`poll()` 的回傳值加上 `drift: held.has('drift')`**，跟現有其他動作
   同一個模式（每次回傳完整欄位，不要用「不傳代表維持前值」那種寫法——
   `player-input.ts` 現有的設計已經是這樣，蕭規曹隨）。

---

## 順便：`npm test` 沒有自動 build，會產生誤導性錯誤

我驗證這輪東西時，在乾淨結帳後直接跑 `npm test`，得到：

```
Error: physics module must export TRACK_GEOMETRY from @physics/constants
```

看起來像物理程式碼壞了，其實只是 `build/out/` 不存在或是舊的——
`w1-physics.mjs` 預設讀 `build/out/assets/world-*.js`，沒先 `npm run build`
就會踩到這個。先 `npm run build` 再 `npm test` 就正常過。

**這是你的 `package.json`，順手修：** `"test"` script 改成先 build 再跑
（例如 `"test": "npm run build && node tools/validate/w1-physics.mjs"`），
避免下次有人（包含 Codex 或未來的你）在忘記 build 時看到這個誤導性的
錯誤訊息去查一個不存在的物理 bug。

---

## 不要做

不要碰 `src/render/`、`src/physics/`、任何 `BAR-*.md`。HUD 要不要顯示
漂移充能/tier 狀態是 `src/render/`（Claude Code）的事，不是這輪範圍，
不要自己加。

## 完成的定義

- [ ] 按住漂移鍵/按鈕 + 轉向，車子真的進入漂移（可以用 `npm run dev`
      實際操作確認，不要只看 typecheck 過就交）
- [ ] 觸控按鈕存在且可用（iPad Safari 或至少 pointer 事件邏輯正確）
- [ ] `npm test` 不需要手動先 build 就能正確跑完
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] `poll()` 的其他既有動作（throttle/steer/brake/reverse/jump）行為不變

## 實作方式由你決定

鍵位選哪個、觸控按鈕怎麼排版，不要問我。
