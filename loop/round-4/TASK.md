# R4 — W2 手感：drift-miniturbo

**Wave:** W2
**Element:** `drift-miniturbo`（cap 400k，見 `loop/budget.json`）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** R3 `77e03bc`——telemetry + validator，我獨立驗證過屬實

---

## 這輪你同時是 builder 也是 critic

`feel.py`／`ghost-replay` 是你自己上一輪做的，零 LLM 成本。**不用等我跑**，
你自己重播 + 判定，把新的 `VERDICT.json` 寫進 `loop/round-4/`，我事後審。

---

## 現況（`loop/round-3/VERDICT.json`）

```
verdict: FAIL
largest_gap: { id: "4.5", delta: "actual=0, below lower bound 1.5", priority_rank: 2 }
```

**只修 4.5 一項。** §2/§3.1–3.4 已經 PASS，不要動 `world.ts` 裡跟這些相關的部分。

---

## 契約缺口我先補了：`WorldInput.drift`

`BAR-FEEL §4` 原本只定義漂移的結果指標（充能時間、位移增益），沒定義怎麼觸發——
這是我寫 bar 時的疏漏，不是留給你猜的。已經補進 `src/contract/sim.ts`：

```ts
drift?: boolean;  // 按住進入/維持，放開釋放
```

`BAR-FEEL.md §4` 新增了一段「輸入機制」，把進入條件、維持期間狀態機、
釋放語意、提早放開的處理都寫清楚了——**開工前先讀那段**，不要重新設計一次。

---

## 基準線怎麼量（4.5–4.7 的分母）

`BAR-FEEL §4` 原文：「同一 fixture 跑兩次，一次全程漂移釋放，一次全程直線
油門到底，取釋放後 2.0 秒的位移差 ÷ `CAR_LENGTH`」。

你的 `ghost-replay.mjs` 目前只讀一份 `input_segments` 跑一次。這輪需要讓
`feel.py` 或 telemetry 拿得到「兩次跑法」的資料才能算出 `car_lengths_gained_*`。
`feel.py` 的 `_baseline()` 函式已經預留了讀 `meta.baselines` 的路徑（結構是
`{"1": {...}, "2": {...}, "3": {...}}`，每項可以是 `car_lengths_gained` 或
`drift_distance`/`straight_distance` 兩種格式）——**怎麼產生這個 baseline
區塊由你決定**：可以是 `ghost-replay` 多跑一次直線版本寫進同一份 meta，
也可以是另一支腳本專門算基準線。不要問我要哪一種。

---

## 順便處理：`fixtures/lap-a.json` 沒有 reverse 區段

跟這輪主線無關，但你反正要碰 fixture，順手加：目前四個 input segment 全部
`reverse: false`，導致 `BAR-FEEL §3.5` 永遠 FAIL（`reverse_top_speed_ratio`
恆為 0）。目前被 4.5 蓋住沒浮現，等你修完 4.5，§3.5 會冒出來，容易被誤判成
物理退化——其實是 fixture 從沒測過倒車。加一段短暫的 reverse 輸入即可，
不用整份重新設計。

---

## 完成的定義

- [ ] `driftState`／`driftCharge`／`driftTier` 依輸入機制正確轉換
- [ ] 4.5 落在 `[1.5, 2.5]` 車身
- [ ] 4.1–4.4、4.6–4.10 不要求全過，但不要故意破壞——有餘力就一起看
- [ ] §2/§3.1–3.4 不退化（用 `w1-physics.mjs` 和 `feel.py` 重跑確認）
- [ ] 決定性不破：`ghost-replay` 三次仍 byte-identical
- [ ] `npm run typecheck`、`npm run build` 皆 exit 0
- [ ] 新的 `loop/round-4/VERDICT.json` 由你自己產生並附上
- [ ] `loop/budget.json` 的 `drift-miniturbo.spent` 自行更新

## 不要做

不要碰 `src/render/`、`src/ui/`、`CHARACTERS.md`、任何 `BAR-*.md`
（本輪已有的 `BAR-FEEL §4` 修補是我加的，不代表你這輪可以再改 bar）。
不要為了衝 4.5 去調 §2/§3 已經過的數值。

## 4.5 撞 cap 怎麼辦

`BAR-FEEL §4.5` 的特殊地位：**不適用 LOOP-OPS §6 的預算型停止**。
400k 花完 4.5 還沒過，不要自動跳下一個元件，寫進 `loop/BACKLOG.md`
現況/已嘗試方向，停下來等我裁決是否加碼。

## 實作方式由你決定

drift 的物理模型（yaw 助力曲線、tier 切換的判定方式、位移增益怎麼實際體現
在物理積分裡）不要問我，你自己設計，只要指標數字對得上。
