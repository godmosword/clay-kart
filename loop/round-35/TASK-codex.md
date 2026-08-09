# R35 給 Codex（ck-physics）—— 撞牆卡死，優先於全部視覺工作

## 為什麼這條排第一

**這是整個專案第一個「所有自動化檢查全綠、真人玩五分鐘就撞到」的缺陷。**

R34 結束時 `BAR-FEEL` 46/46 全 PASS，其中 `§6.5 wall_stick_frames = 2`
（窗口 `[0, 3]`）也是 PASS。然後第一次真人試玩的回報是：

> 撞牆的時候車子無法倒退跟轉向

一個會卡死的遊戲，美術再好都沒用。所以視覺線全部往後排。

---

## 根因是兩個各自正確的改動互相抵消

### 第一層：`§6.5` 依賴一個被刻意歸零的訊號

`tools/validate/feel.py:585` 計卡牆幀的條件是：

```python
_finite(frame.get("collision_impulse")) > 0
and _speed(frame) < wall_stick_speed_threshold
```

而 `src/physics/world.ts:657`，在「已穿透但沒有向外速度」的分支
——**正是車頭頂著牆不動的那個狀態**——明文寫著：

```ts
// A penetrating pose with no outward velocity is a positional correction,
// not a new impact. Keep the velocity and leave collisionImpulse at zero
// so telemetry does not report a stationary wall contact as a hit every tick.
this.#collisionImpulse = 0;
```

**那個改動本身是對的**（靜止貼牆不該每幀回報成一次撞擊），
**它順手關掉了依賴它的偵測器**。車頂著牆不動 → `impulse = 0` → 不計入 →
`wall_stick_frames` 永遠是 0。中間沒有任何東西守住這個依賴關係。

### 第二層：倒車需要同時按住油門

`world.ts:535` 的倒車在 `else if (this.#throttle > 0)` 底下。
玩家只按 `Shift` 什麼都不會發生。而卡在牆上時速度為 0，轉向也建立不起來
——三件事疊起來就是完全動不了。

---

## FROZEN 開閘（Lead 裁決，窄幅，僅此範圍）

`world.ts`／`constants.ts`／`feel.py`／`test_feel.py` **四個都在 `FROZEN.md`**。
這是 `feel.py` 自 R22 關閘後第一次重新開啟。

### 准許

1. **`§6.5` 的量測定義重寫**：改成「持續貼著邊界且地面速度低於門檻的連續幀數」，
   **與有沒有新的撞擊無關**。需要什麼新的 telemetry 欄位就加
   （建議 `wall_contact: boolean`，由 `#resolveWallCollision` 直接標記，
   不要再從 `collision_impulse` 推導）。
2. **倒車不再需要同時按油門**：`reverse` 為真時就該能倒車。
   保留 `throttle` 對倒車**加速度大小**的影響是可以的，但
   「只按倒車鍵、車完全不動」必須消失。
3. **卡死時要能脫困**：貼牆靜止時仍可轉向（真車做得到，原地打方向盤）。
   實作方式你決定。

### 明文禁止

- **不得放寬 `§6.5` 的窗口** `[0, 3]`。這一輪的目的是讓它**量到真實情況**，
  很可能因此變成 FAIL——**那就是正確的結果**，不要為了讓它綠而調窗口。
- 不得更動其餘 45 項的任何窗口或推導。
- 不得新增 fallback／`configured_*` 之類的頂替分支（R14 就是這個形狀）。
- 不得為了修這條去重新平衡漂移或加速的參數。

### 交件條件（硬性）

- **重跑 `ghost-replay` + `feel.py`，46 項逐項對照 R22／R34**。
  `§4.10 drift_speed_retention` 目前是 `0.9697186325`，上限 `0.97`，
  **絕對餘裕 0.00028**——這是全專案最薄的一項，任何物理改動都可能推掉它。
  逐項貼出來，不要只寫「46/46」。
- **附上一段能重現卡死的 probe**：撞牆後只按倒車、只按轉向，
  記錄多少幀之後車子真的動了。這是這一輪唯一能證明「修好了」的證據。
- artifact 直接 commit 進 `loop/round-35/artifacts/`。
- push 到 `feat/physics`，回報 commit sha 與實測數字。

---

## 給你的提醒

`origin/feat/physics` 現在就是 `main`（R34 收尾時對齊過），
直接 `git fetch && git checkout feat/physics` 就是最新的，
**不要 `reset` 回舊的、不要 rebase 已發布的 commit**——
見 `loop/README.md` 的「Builder 的邊界」。

那一節的四條每一條都對應 R33 實際發生的事，三十秒讀完。
