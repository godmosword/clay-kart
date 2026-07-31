# R2 — Codex

**Wave:** W1 收尾
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** `4f95c13` R1 physics — **PASS**，四項落差確實關閉，我獨立驗過

兩件小事。**先做落差一**，它擋住 Claude Code 的賽道渲染。

---

## 落差一（先做）— 賽道幾何無法被渲染器取得

**現況：** `src/physics/world.ts` 的 `TRACK_RADIUS`（30）、`TRACK_CENTER_Z`（30）、
`TRACK_HALF_WIDTH`（6）是 module-private。`src/physics/constants.ts` 目前只匯出
`BASE_TOP_SPEED` / `CAR_LENGTH` / `CAR_WIDTH`。

**目標：** 渲染器要畫出玩家實際會撞到的那條賽道。碰撞邊界與畫面上的牆必須是同一組數字。

**落差：** 渲染器（`src/render/`，Claude Code 的範圍）讀不到賽道幾何，只能硬編。
硬編之後，你這邊一改賽道，畫面與碰撞就靜默不同步 —— 而且不會有任何測試會發現。

**注意：** `KART_BOUNDING_RADIUS`、`INNER_COLLISION_RADIUS`、`OUTER_COLLISION_RADIUS`
是由上述三個值推導出來的。渲染器需要的是**賽道本身**的幾何，不是加上車體半徑之後的碰撞面。
兩者的差別要讓使用者分得出來。

---

## 落差二 — harness 的圓心座標靠巧合成立

**現況：** `tools/validate/w1-physics.mjs` 第 100 行與第 111 行：

```js
const radius = Math.hypot(x, z - TRACK_RADIUS);
```

用 `TRACK_RADIUS` 當圓心的 Z 座標。實際圓心是 `TRACK_CENTER_Z`。
兩者目前都是 30，所以測試會過。

**目標：** 這支 harness 是 W2 全部驗收的基礎，它驗的東西必須正確。

**落差：** 賽道圓心一移動（W3 有四條賽道主題），這支測試會**靜默驗錯位置**，
而且仍然回報 PASS。這比測試失敗危險。

---

## 完成的定義

- [ ] 渲染器可從 `@physics/` 取得賽道幾何，且與碰撞使用同一組數字
- [ ] harness 不再依賴 `TRACK_RADIUS === TRACK_CENTER_Z` 的巧合
- [ ] `node tools/validate/w1-physics.mjs` 仍 PASS
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] physics chunk 未引入 three
- [ ] R1 的所有行為不退化（決定性、三圈計時、§3 窗口、穿透 `[0, 0.05]`）

## 不要做

不要調 `BAR-FEEL §3`–§8 的數值。不要加漂移或 mini-turbo。
不要改 `src/loader/`、`src/render/`、`package.json` —— 那些不是你的範圍。

## 兩個記錄在案、本輪不處理的觀察

R1 審查時發現，**不需要你現在動**，W2 到相關元件時再說：

1. **穩態轉彎完全不損速。** 你在 R1 加的 `targetGroundSpeed` 重標定造成的。
   實測直線與全鎖轉向穩態速度都是 24.00，保留率 1.0000。
   `BAR-FEEL §4.10 drift_speed_retention` 窗口是 `[0.88, 0.97]`，會卡在窗口外。
   極速上限沒被突破，不是漏洞，是模型選擇。W2 的 `drift-miniturbo` 元件再處理。

2. **§5.3 現在量到 0s**，低於窗口 `[0.15, 0.35]`。
   這是對的 —— R1 的任務是讓它「可量測」，不是讓它「在窗口內」。
   數值調校是 W2 的 `steering-grip` 元件。

## 實作方式由你決定

上面只描述現況／目標／落差。怎麼修由你判斷。
