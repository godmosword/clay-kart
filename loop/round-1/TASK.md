# R1 — W1 物理修正

**Wave:** W1
**Element:** `physics-loop`
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** `35cfeef` W1 physics: deterministic kart world and lap collider

---

## 這輪的判定

**W1 判 PASS。** `loop/PLAN.md` 的 W1 完成條件是「一台車、一條封閉賽道、圈數計時、能開不卡」，
四項都達到，而且品質好。你的所有聲明我都獨立驗證過，**全部屬實**：

| 聲明 | 驗證結果 |
|---|---|
| 固定 120Hz | ✓ |
| 決定性 | ✓ 3000 ticks 三次 byte-identical；加轉向輸入兩次亦一致 |
| 碰撞不穿透 | ✓ 最大穿透 `1.4e-14`，`BAR-FEEL §2.3` 窗口 `[0, 0.05]` |
| 3 圈計時、splits、bestTime | ✓ `8.875 / 7.867 / 7.867`，對照理論最快 7.85s 合理 |
| physics chunk 3.37 kB 未引入 three | ✓ |
| typecheck / build | ✓ 皆 exit 0 |
| §2 禁用 API | ✓ 六項全部 0 處 |

加速曲線甚至已落在 `BAR-FEEL §3` 窗口內（0.800 / 2.675 / 23.954 / 倒車比 0.399），
重力 30 落在 §7.2 `[26,34]`。這些是預設值就合理，不是過度調校，很好。

**但檔案不進 `FROZEN.md`。** 下列四項在 W2 開跑前必須解決 —— 否則 `BAR-FEEL §5` 整節
與 §4.5 的基準線都不可信，而那正是 W2 要花最多輪次調的東西。

證據：`loop/round-1/artifacts/lead-audit.mjs` 與 `lead-audit-output.txt`。
那支腳本可獨立執行（`world.ts` 對 bootstrap 只有 type-only import）。

---

## 落差一（HIGH）— 零轉向輸入時 yaw_rate 無法歸零

**現況：** 實測轉向中 `yawRate = 0.023`，放開轉向後變成 `-0.797` 並永遠維持。
車在零輸入下持續繞圈。位置：`src/physics/world.ts` 的 `#stepYaw()`。

**目標：** `BAR-FEEL §5.3 yaw_settle_time_s`，窗口 `[0.15, 0.35]`，
定義為「放開轉向至 `yaw_rate` < 5%」。

**落差：** 該條件在目前模型下**永遠不成立**，因此 §5.3 不是 FAIL 而是**不可量測**。
§5.4 `yaw_overshoot_ratio`（窗口 `[0.0, 0.12]`）同樣不可量測，
§5.2 `min_turn_radius_u`（窗口 `[7.0, 9.5]`）被常數偏置扭曲。

**附帶：** `TRACK_RADIUS = 30` 目前參與車輛物理計算。W3 有四條賽道主題
（`CHARACTERS.md §1`），半徑不同時車的轉向行為會跟著變。

---

## 落差二（HIGH）— 零轉向輸入時位置被貼齊中心線

**現況：** 實測零輸入時車與圓心距離為 `30.000000000`，精確等於 `TRACK_RADIUS`。
位置：`src/physics/world.ts` 的 `#followTrackCentreline()`，
於 `step()` 中在 `#resolveTrackCollision()` **之後**呼叫。

**目標：** 車的位置必須是物理積分的結果。

**落差：** 三個後果——

1. 零轉向輸入時車永遠碰不到牆，因此「碰撞不穿透」只在有轉向的路徑上被驗證過
2. 它覆蓋 `#resolveTrackCollision()` 的結果
3. **`BAR-FEEL §4.5` 的基準線定義是「一次全程直線油門到底」。**
   那條基準線目前會是貼齊軌道的結果而非物理。§4.5 是全份 `BAR-FEEL`
   **唯一「單獨 FAIL 就退回整波」且不適用預算型停止**的指標——它的基準線不可信，
   等於整個 W2 的驗收核心不可信。

---

## 落差三（MEDIUM）— 契約常數重複定義，不匹配時執行期崩潰

**現況：** `src/physics/world.ts` 自行定義 `TICK_HZ`、`TICK_DT`、`BASE_TOP_SPEED`、
`CAR_LENGTH`，對 `@loader/bootstrap` 只有 type-only import。
但 `src/loader/bootstrap.ts` 已 `export const TICK_HZ / TICK_DT`。

**目標：** `BAR-FEEL §1.1` 明定這些是契約常數，單一真實來源。

**落差：** 實測 `step(1/60)` 拋 `RangeError`。若 Lead 依 §1.1 調整 `TICK_HZ`，
`bootstrap.ts` 會更新而 `world.ts` 仍是 120，**每一幀都拋例外**——
且這是執行期崩潰，typecheck 與 build 都不會發現。

---

## 落差四（MEDIUM）— 沒有測試或 fixture 進版控

**現況：** commit `35cfeef` 只有 `src/physics/world.ts` 一個檔案。

**目標：** `CODEX.md §5` 要求 ghost-replay「同輸入跑三次，輸出 byte-identical」，
`§4 完成的定義`要求可重複驗證。

**落差：** 「headless deterministic smoke test 通過」的證據不在 repo。
決定性是真的（我驗過），但驗證它的是 Lead 的臨時腳本，不是專案資產，
下一輪沒有人能重跑。W2 的整套驗收建立在這個 harness 上。

---

## 本輪範圍

修上述四項。**不要做 W2 的事**——不要加漂移、mini-turbo、道具、AI 對手，
不要調 `BAR-FEEL §3`–§8 的數值。目前的數值已經在窗口內，動了要重調。

`FROZEN.md` 目前是空的，沒有檔案被凍結。

## 完成的定義

- [ ] 零轉向輸入、平直行駛時 `yaw_rate` 可收斂到 0，`BAR-FEEL §5.3` 變成**可量測**
- [ ] 車的位置為物理積分結果，零轉向輸入下也可能碰到牆
- [ ] 穿透仍滿足 §2.3 `[0, 0.05]`，NaN/Inf 仍為 0（§2.4）
- [ ] 契約常數單一來源，`TICK_HZ` 變動時不會執行期崩潰
- [ ] 決定性測試進版控且可重跑，三次 byte-identical
- [ ] 圈數計時行為不退化：3 圈、splits、bestTime 仍正確
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] physics chunk 未引入 three
- [ ] `BAR-FEEL §3` 既有的四項不退出窗口（0.800 / 2.675 / 23.954 / 0.399 為現值）

## 不歸你的

`setInput()` 目前沒有任何呼叫端，車自己在跑。輸入處理屬 `src/ui/` 或 `src/loader/`，
不是你的寫入範圍。這是 Lead 拆任務時沒指派清楚，已記入 `loop/BACKLOG.md`，
你不用處理，也不要為此改 `src/loader/`。

## 實作方式由你決定

不要問架構。上面只描述「現況 / 目標 / 落差」，沒有指定怎麼修——這是刻意的。
你自行決定實作路徑。
