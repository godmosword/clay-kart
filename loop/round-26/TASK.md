# R26 — 探針補讀 `renderedFrames`，讓 `§4` 的 FAIL 指對方向

**Wave:** W3（`BAR-PERF` 基礎設施）
**Owner:** Codex（`../ck-physics`，分支 `feat/physics`）
**前一輪:** `a2ba9b7` —— 探針已改讀 `__CLAY_RENDER_TELEMETRY__`，`§4.1` 的跨界耦合已拔除

---

## 問題

`src/contract/render-telemetry.ts` 有**四個**欄位，`perf-probe.mjs` 只讀了三個。
**`renderedFrames` 沒有被讀。**

那個欄位是 R25 接線時特地補的分母。少了它，`§4.2`／`§4.3` 算出來的東西跟
R25 之前的 `renderedHz` 別名沒有實質差別：

```
vehicle_transform_hz = vehicleTransformUpdates / elapsed
```

而 `vehicleTransformUpdates` 是**每個算繪幀寫一次**，所以這個式子必然等於算繪率。
Lead 端到端實測（`a2ba9b7` 之後，同一支 build）：

| 指標 | 值 |
|---|---|
| `vehicle_transform_hz` | 20.796 |
| `camera_hz` | 20.796 |
| `fps_p50` | 21.739 |

兩者貼著算繪率跑。窗口 `[58, 62]` 在任何跑不到 60fps 的機器上必然 FAIL，
**而 `BAR-PERF §4.4` 明文說那個 FAIL 該讀成「算繪慢」不是「抽格套錯對象」**——
`§6` 把 `§4` 排在優先序第一，於是 `largest_gap` 每次都指向抽格，實際問題卻是效能。

## 要做的事

**在 artifact 裡補上 `renderedFrames` 與三個比值。** 就這樣。

```
render_telemetry_counters: {
  renderedFrames: <delta>,              // 新增
  vehicleTransformUpdates: <delta>,
  cameraUpdates: <delta>,
  characterAnimationFrames: <delta>,
}
render_telemetry_ratios: {              // 新增
  vehicleTransformPerFrame: vehicleTransformUpdates / renderedFrames,
  cameraPerFrame: cameraUpdates / renderedFrames,
  characterAnimationPerFrame: characterAnimationFrames / renderedFrames,
}
```

「有沒有抽格」的正確算法是 `updates / renderedFrames`，**該是 1.0 且與機器
快慢無關**。ck-visual 端已實測過：275 幀對 275 次 transform 更新，比值 1.000，
而那台機器當時只跑 55fps。

## 明確不要做的事

- **不要動 `§4.2`／`§4.3` 的窗口。** `[58, 62]` 維持原樣——R25 已裁決
  「修儀器不調窗口」，調窗口只會把壞掉的儀器合法化
- **不要改變任何 PASS/FAIL 結果。** 這一輪只增加 artifact 的資訊量。
  跑完之後 `4.1`／`4.2`／`4.3` 的 status 必須與 `a2ba9b7` 完全相同
- 不要新增 `§4` 的檢查項。比值先當證據記錄，要不要拿它當判準是之後的裁決

## 完成的定義

- [ ] `perf-probe.mjs` 讀 `renderedFrames`，artifact 含上述兩個區塊
- [ ] `device-probe.mjs` 同步（兩支探針的 artifact 結構要一致）
- [ ] 缺 `renderedFrames` 時走與其他 counter 相同的明確 FAIL 路徑，**不得 fallback
      成 1 或用 `glFrames` 頂替**——那會讓「render 端沒接線」看起來像「接了但沒抽格」
- [ ] 同一份 build 前後跑，`4.1`／`4.2`／`4.3` 的 `status` 逐項相同
- [ ] 實測比值：`vehicleTransformPerFrame` 與 `cameraPerFrame` 應為 1.000，
      `characterAnimationPerFrame` 約 `12 / fps`
- [ ] pytest 全數通過（含針對「缺 `renderedFrames`」的新測試）
- [ ] artifact 的 `meta.build_sha` 正確（`loop/schema/provenance.py` 會檢查）

## 為什麼這件事值得做

`§4` 是 `BAR-PERF §6` 優先序第一的條款，理由是「抽格套錯對象會同時毀掉手感與
定格感」。它現在**量得到正確的數字，但報出來的 FAIL 指錯方向**。

補這個分母之後，`§4` 第一次能回答它真正要問的問題：**載具與相機有沒有被抽格？**
而那個答案與機器快不快無關——在沒有基準機的現在，這是唯一一條可以在開發機上
就得出結論的 `BAR-PERF` 條款（`§4.1` 已經是，`§4.2`／`§4.3` 差這一步）。
