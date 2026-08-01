# R7 — W2 手感：collision-response

**Wave:** W2
**Element:** `collision-response`（`loop/budget.json` cap 200000，見 `BAR-FEEL §6`）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R6 `3375c96`——`steering-grip` 完成，我獨立驗證是至今最乾淨的一輪
（全指標掃描沒有任何意外退化）。

---

## 為什麼換元件

`steering-grip` 的核心目標（5.2/5.3/5.7/5.8/5.9）全數 PASS，§5 沒有像
`4.5` 那種硬門檻指標，不需要繼續磨。預算花了 625276（cap 250000，
超支 150%）。轉下一個元件：`collision-response`（`BAR-FEEL §6`）。

**兩輪下來，`drift-miniturbo` 超支 56%、`steering-grip` 超支 150%，
`budget.json` 原本估的 cap 系統性偏低。** 這輪不再要求你控制在 cap 內，
專注把 §6 做對，token 用量老實記錄，之後我會整體重估 cap。

---

## 現況（`loop/round-6/VERDICT.json` 的 §6 部分）

```
6.1  wall_speed_retention        0.0   窗口 [0.55, 0.75]  FAIL
6.2  wall_head_on_retention      0.0   窗口 [0.05, 0.2]   FAIL
6.3  collision_recovery_time_s   0.0   窗口 [0.2, 0.45]   FAIL
6.4  kart_kart_impulse_symmetry  0.0   窗口 [0.92, 1.08]  FAIL
6.5  wall_stick_frames           291   窗口 [0, 3]         FAIL
```

**這五項的性質不一樣，分開處理：**

---

## 6.1／6.2／6.3：不是物理沒調，是 telemetry 從沒記錄這些資料

我查過 `tools/telemetry/ghost-replay.mjs` 的 `eventsBetween()`：`collision`
事件目前只帶 `{ impulse: ... }`。`feel.py` 用 `_event_value(collision_events,
"wall_speed_retention")` 之類的方式去讀事件的 `data` 欄位，但那個 key
從來沒被寫進去過，所以永遠拿到預設值 `0.0`——**不是碰撞後速度保留率是
0，是這件事從沒被記錄過。**

**要做的（這是你的範圍，`tools/telemetry/` 在你的寫入權限內）：**
`collision` 事件需要在碰撞發生的那個 tick，記下碰撞前後的速度資訊，
讓 `feel.py` 算得出：

- `6.1`（30° 擦牆後速度保留率）與 `6.2`（正面撞牆速度保留率）需要區分
  碰撞角度（法線與行進方向的夾角），擦牆跟正面撞是不同窗口
- `6.3`（恢復可控時間）需要知道碰撞後多久 `yaw_rate`／轉向響應恢復到
  正常範圍——你自己定義「恢復可控」的判定條件，寫進 commit message 或
  `VERDICT.json` 的 checks 讓我看得懂你怎麼判定的

物理面可能也需要調（現在的 `WALL_BOUNCE = 0.15` 常數是 R1 就有的，
沒人驗證過它落在 6.1/6.2 的窗口內），但**先把資料記出來，才知道要不要調**。

---

## 6.4：現在量不了，不要為了它去改物理

`kart_kart_impulse_symmetry` 測的是**車對車碰撞**，但 `SimSnapshot.kart`
目前是單數欄位，整個模擬只有一台車——沒有第二台車可以撞。這個指標在
`loop/BACKLOG.md`「W2 觀察：SimSnapshot 目前只支援單車」那條已經記錄過，
觸發點是「`ai-opponents` 元件開工前」，跟這輪無關。

**這輪跳過 `6.4`，不要嘗試用單車湊出一個對稱性數字。** 該指標會維持
FAIL 直到 `ai-opponents` 元件真的把多車架構做出來。

---

## 6.5：真的在測，是真落差

`wall_stick_frames` 不像 6.1–6.3，這個是從 `pos`／`collision_impulse`
直接算出來的，是真數據。R3→R6 這個數字一路是 177→285→291，緩慢惡化。
懷疑跟 `#resolveTrackCollision()` 的邊界解算方式有關（車貼著牆持續受
微小穿透修正，每 tick 都被判定為「還在碰撞」)，但這是我的猜測，你自己
查。**R6 修好轉彎半徑後這個數字沒有改善（285→291，還變差了一點），
所以不是轉向的問題，是碰撞解算本身。**

---

## 完成的定義

- [ ] `collision` 事件記錄足夠資訊讓 `6.1`/`6.2`/`6.3` 真的能算（不是
      硬編碼、不是永遠 0）
- [ ] `6.1`/`6.2`/`6.3` 依你記錄的真實資料判定 PASS/FAIL，PASS 與否
      都可以，但要是真的測出來的（同 R5 對 `4.10` 的標準）
- [ ] `6.4` 維持 FAIL，不強求，`VERDICT.json` 的說明清楚寫明原因是
      單車架構限制
- [ ] `6.5` 有實際調校嘗試，說明你查到的根因
- [ ] §2/§3/§4/§5（尤其 `4.5`、`5.2`/`5.3`/`5.7`/`5.8`/`5.9`）不退化
- [ ] ghost-replay 三次仍 byte-identical
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] 新的 `loop/round-7/VERDICT.json` 你自己產生，schema 驗證通過
- [ ] `loop/budget.json` 的 `collision-response.spent` 更新（不設超支上限，
      如上所述）

## 不要做

不要碰 `drift-miniturbo`／`steering-grip` 已經調好的常數。不要嘗試讓
`6.4` PASS。不要為了湊 `6.1`/`6.2`/`6.3` 的數字而在 `feel.py` 裡放
另一個硬編碼常數——R4 已經因為這樣被抓到一次，R5 才修正，不要重蹈覆轍。

## 實作方式由你決定

碰撞事件要記錄哪些欄位、恢復可控怎麼判定、擦牆角度用什麼方式偵測，
不要問我。
