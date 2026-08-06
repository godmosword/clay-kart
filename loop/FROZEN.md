# FROZEN — 禁止修改

以下檔案已通過對應 bar，任何 agent 不得修改。
若確信需要改動，寫進 `loop/BACKLOG.md` 由 Lead 裁決。

> 長跑最大的浪費不是難題解不掉，是 agent 反覆重新推翻已經解決的東西。
> 這份清單省下的額度可能比其他所有措施加起來還多。

**這不是一道鎖，是一道閘。** 凍結不代表那個檔案永遠不能改，代表要改必須先經過
Lead 裁決——對本專案而言，這道閘擋的主要是「量測工具被悄悄放寬到剛好通過」這一類
問題（R4 的 `4.9`/`4.10` 硬編碼、R14 的 `configured` 頂替 `observed`，兩次都是
Lead 事後抓到的，不是任何自動化機制擋下來的）。

---

## 永久凍結（基礎設施）

- `tools/telemetry/runtime.mjs`    # 共用 headless runtime，W2 全程未因指標調整而改動

`tools/telemetry/` 其餘兩支**刻意不在此列**，理由見下方「未凍結」。原本這一節寫的是
「`tools/telemetry/*` 在 Codex 完成 LOOP-OPS §4.1 後立即加入」——整個目錄一起凍會擋到
還沒解決的 `4.4`/`4.6`/`4.7` 與 `gc_pause_max_ms`／`texture_memory_mb`，改為逐檔。

## W2

### 量測工具（`BAR-FEEL` 的唯一裁判）

- `tools/validate/feel.py`         # R15 PASS 42/46, BAR-FEEL §2,§3,§5,§6,§7,§8,§12
- `tools/validate/test_feel.py`    # 同上，保護 feel.py 的測試一併凍結

> **閘已關回（R22 收尾，`43efe59`）。** 兩件准許的事都完成且經 Lead 獨立驗證：
> main 重跑 `ghost-replay` + `feel.py` 得到 46/46 PASS，與已提交的
> `loop/round-22/VERDICT-feel.json` **逐項零差異**；缺 `--round`／`--output`
> 時 exit 2。`feel.py` / `test_feel.py` 即刻恢復完全凍結。下方保留原始開閘
> 條件作為紀錄，**不再有效**——要再改需重新裁決。
>
> 合規審查結果：窗口一項未動；無 fallback／`configured_*` 頂替分支
> （`tier3_probe["charge_time_s"]` 用直接下標，缺欄位 KeyError 而非靜靜頂替；
> probe 不存在時 `4.4` 維持 `0.0` 誠實 FAIL）；其餘 45 項推導未動。
> `4.4 = 3.5083333` 經核實是真量測——`TICK_HZ=120`，probe 記的
> `drift_start_tick=121`、`tier_up_tick=542`，`421/120` 落在設定門檻 3.5s
> 之後恰好一個 tick 的偵測延遲，不是把常數頂替進去。
>
> ---
>
> **窄幅開閘（R22，Lead 裁決，僅此一次、僅此範圍）—— 已於上方關閉**
>
> Codex 在 `a074615` 補了 tier1/tier3 drift probe，`4.4 tier3_charge_time_s` 的
> raw probe 已有真實數值（3.5083s），但 `feel.py` 沒有讀新欄位所以仍顯示 `0.0`。
> 它正確地停在閘門前沒有自行修改，回報 blocked——**這道閘第一次被實際使用，
> 行為完全符合設計**。
>
> **准許的兩件事，其餘一律不准：**
> 1. 拿掉 `--round` / `--output` 的預設值，改為必填（見 BACKLOG 的 provenance 條目）
> 2. `_drift_metrics()` 讀取 tier3 probe 的欄位，讓 `4.4` 反映實際量到的值
>
> **明文禁止：** 不得更動任何窗口；不得新增任何 fallback／替代值／`configured_*`
> 之類的頂替分支（R14 就是這個形狀）；不得改動其餘 45 項的推導方式。
> **`4.4` 若落在 `[3.3, 3.7]` 之外就誠實 FAIL**——這輪的目的是讓它反映真值，
> 不是讓它通過。
>
> **交件要求：** VERDICT 必須附上同輪 committed 的 telemetry，不得再出現
> `artifacts` 指向容器暫存路徑而倉庫內無法重建的情況。
>
> **為什麼要加這些條件：** `a074615` 同一個 commit 裡調整了漂移物理常數
> （`MINI_TURBO_GAIN_BY_TIER` 三個 tier 全改、新增只給 tier 2 的
> `MINI_TURBO_VELOCITY_KICK_BY_TIER`）。剛調完受測物的一方，緊接著要改判它的
> 那把尺——這正是 FROZEN 存在的理由，所以開閘但不撤閘。
>
> 收尾後 `feel.py` / `test_feel.py` 回到完全凍結，不需要再次裁決。

四項 FAIL（`4.4`/`4.6`/`4.7`/`4.10`）全在 `§4` drift，根因都不在 validator：
`4.4`/`4.6`/`4.7` 研判是 fixture 覆蓋率（只跑過單一 tier2 釋放路徑），
`4.10` 是物理層缺少漂移中的持續速度損耗機制——兩者要動的是
`tools/telemetry/ghost-replay.mjs` 與 `src/physics/world.ts`，兩個都沒凍結。
若補完 probe 之後 `feel.py` 真的需要讀新欄位，走 BACKLOG 裁決，那正是這道閘的用途。

### 已完成元件的實作

- `src/ai/controller.ts`           # R15 PASS, BAR-FEEL §12.1–§12.4

`ai-opponents` 四項行為指標 R15 全數真實 PASS 並經 Lead 獨立驗證。BACKLOG 的 R15
條目已標明 `12.3` 的 margin 只剩 `0.0167s`，「之後再調整 rubberband/difficulty
相關參數，`12.3` 有可能被連帶推出窗口」——那正是應該先經裁決再動的情況。

### 介面契約（Lead 專屬，非 PASS 憑證）

- `src/contract/sim.ts`            # LOOP-OPS 實作偏離指定；R20 補上 steer 語意後定案

依 `LOOP-OPS.md`「`src/contract/sim.ts` 一旦穩定即列入 `FROZEN.md`」。R20 之前這個
檔案對 `WorldInput.steer` 只寫「轉向輸入：-1 到 1」而沒定義哪邊是右，**兩邊各自實作
各自合理、合起來就反了**——契約留白直接造成了一個要靠實機截圖才抓得到的缺陷。
R20 已把定義釘在「`steer > 0` 使 yaw 增加」，最後一處已知留白補上。

## W3

尚無。12 個元件目前**沒有任何一個拿到視覺 critic 判決**——`loop/round-20/` 與
`loop/round-21/` 只有 `VERDICT-perf.json`／`VERDICT-feel.json`，倉庫、三個 worktree、
所有分支與已 merge 的 PR #1 內都不存在視覺 critic 的 `VERDICT.json`。規則 1 一項都不滿足。

---

## 未凍結，以及為什麼（避免下次重查一次）

| 路徑 | 為什麼不凍 |
|---|---|
| `src/physics/world.ts` | `4.4`/`4.6`/`4.7`/`4.10` 未解，回頭補時勢必要動（BACKLOG R4 條目已載明） |
| `src/physics/constants.ts` | `4.10` 要加的「漂移中持續速度損耗」大概率需要新常數 |
| `tools/telemetry/ghost-replay.mjs` | `4.4`/`4.6`/`4.7` 若真是覆蓋率問題，補 tier1/tier3 drift probe 就在這支 |
| `tools/telemetry/perf-probe.mjs` | `gc_pause_max_ms`／`texture_memory_mb` 仍未真的量測，BACKLOG 待裁決項目要改這支 |
| `tools/validate/perf.py` | 同上；`_finite()` 把缺值正規化成 `0.0`，讓「沒測」跟「測到 0」在 VERDICT 裡長得一樣 |
| `tools/visual/*` | W3 共用工具，元件還在做，本來就會持續改 |
| `src/render/`、`src/characters/` | W3 進行中，無 critic 判決 |
| `src/ui/player-input.ts` | R20 才改過轉向對應，目前唯一的驗證是實機截圖，沒有自動化回歸 |

---

## 加入規則

一個檔案加入此清單，必須同時滿足：

1. 對應元件的 `BAR-*` 條款在某輪 `VERDICT.json` 中**逐項 PASS**
2. 該輪的 telemetry / artifact 已 commit
3. 記錄格式：`- 路徑    # R{輪次} PASS, {bar 條款}`

**撞到預算上限而未 PASS 的元件，其檔案不進 FROZEN**（LOOP-OPS §6），
留待日後回頭。落差寫進 `BACKLOG.md`。

> **規則 1 的措辭修訂（R21 收尾）：** 原本寫的是「對應元件在某輪 `VERDICT.json` 中
> `verdict == "PASS"`」。那個條件在 W2 **永遠不可能滿足**——`feel-validator` 對整份
> `BAR-FEEL` 只吐一個總判決，只要 `§4` 還有 4 項 FAIL，`verdict` 就是 `FAIL`，
> `§2`/`§3`/`§5`/`§6`/`§7`/`§8`/`§12` 做得再完整也拿不到憑證。規則的**用意**是逐元件的，
> 措辭卻是逐輪的。改為逐項判讀，凍結範圍仍以元件為界。
>
> **規則 2 為什麼引 R15 而不是 R20：** `loop/round-20/VERDICT-feel.json` 是真的重跑
> 出來的（與 R15 有 ULP 級浮點差異，不是複製檔），但它的 `artifacts` 指向
> `/tmp/.../scratchpad/feel.json`——那個容器已消失，倉庫裡無法重建，不滿足「telemetry
> 已 commit」。最近一次 telemetry 有 commit 的是 R15（`loop/round-15/artifacts/lap-a.json`，
> 6.3MB）。連帶的 `round` 欄位缺陷另見 BACKLOG 新增條目。
