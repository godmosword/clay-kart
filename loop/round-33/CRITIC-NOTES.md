# R33 visual critic — three-run summary

The prompt file was not modified. All three run records used the same material
hashes:

- `contact-sheet.png`: `292efc2b08c7876f831693d118e18afdc1257f4532f648b73e271676b7c39e3f`
- `game-scene.png`: `6cc2f61a7e9a0df4f135b5a2b483c539010bd3b3f96c2c8f167ea17cab316ee8`

The §1.2 index check was correct in all three runs: `r0c0`, `r1c1`, `r2c1`,
and `r5c1` were identified as the four all-placeholder groups.

## Scored groups

| Group | run 1 | run 2 | run 3 | Median | Window | Result |
|---|---:|---:|---:|---:|---:|---|
| `r0c1` | 3 | 3 | 3 | 3 | 4–5 | FAIL |
| `r1c0` | 3 | 4 | 3 | 3 | 4–5 | FAIL |
| `r3c1` | 3 | 3 | 3 | 3 | 4–5 | FAIL |
| `r5c0` | 3 | 3 | 3 | 3 | 4–5 | FAIL |

All four scored groups have cross-run spread below 2 points, so the median is
usable under the pre-committed reading rule. The stable gap is that the
realtime renders have the intended rounded, matte clay direction but remain
visibly simpler and more regular than the close-up hand-shaped photographs:
surface marks, pressed seams, and irregular joins are less legible.

The one unstable absolute judgment is `r1c0` (3/4/3); its segment gaps are
clear, but segment regularity makes the boundary between 3 and 4 sensitive to
how strongly the close-up reference texture is weighted. Its preference
direction is unchanged.

## Unscored groups

`r2c0`, `r3c0`, `r4c0`, and `r4c1` do not have valid A/B pairs and were not
given 1–5 scores. Their visible halves were reported in each raw run and are
mechanical/coverage observations only. The four all-placeholder groups were
also skipped as required.

## Assembled scene

`game-scene.png` is a rear-following view. It shows a compact soft contact
shadow, readable road/grass/curb assembly, and coherent soft daylight. It does
not show the front of the kart, so it cannot establish the assembled-state
front-facing §5.3 requirement that the driver's eyes and smile remain visible.

Raw records: `artifacts/CRITIC-run1.md`, `artifacts/CRITIC-run2.md`,
`artifacts/CRITIC-run3.md`.

---

# Lead 裁決（R33 收尾）

## 一、主產出：儀器修好了

R33 的主產出**不是分數，是變異**。R24 量到的 ±2 分是在一張壞掉的表上量的
（標籤洩漏＋256 色量化＋構圖不對稱），噪音佔多少無法回推。四層修完之後：

| 指標 | R24（壞表） | R33（修後） |
|---|---|---|
| 最大跨輪差距 | **2 分**（`kart-wheels` 參考 4/5/3） | **1 分**（`track-barriers` 3/4/3） |
| 四組中三組差距 | ≥1 | **0** |
| `§1.2` 索引校驗 | 3 輪錯 1 輪 | **3/3 全對** |
| 指認算繪半邊 | 未記錄 | **12/12 全對** |

依 R33 事前寫死的讀法：**4 組全部差距 < 2 → 中位數可用，`§1.1` 是一道真的閘。**
這是 W3 第一次拿到可信的視覺分數。

> 「指認算繪半邊 12/12」同時再次確認 `§3.1`：盲測確實不成立。
> 現在不再假裝，所以它不再是缺陷，只是一個事實。

## 二、分數：四組全部 3 分，誠實 FAIL

門檻 `≥4`。四組中位數都是 3，`VERDICT-visual.json` 判 FAIL 正確。

## 三、四個扣分理由是同一個根因

三輪各自獨立，扣分理由卻高度一致，而且都指向表面缺少手壓細節：

| 元件 | 三輪一致的理由 | 主要幾何 | `applyHandPressedRelief` |
|---|---|---|---|
| `kart-body` | 比參考平滑簡單，**接縫與壓痕不可讀**（§5.0/§5.1） | `claySlab`×3 + `clayBlob`×5 | **一次都沒呼叫** |
| `driver-face` | **一塊扁平的長方形板**，不是圓潤整合的黏土臉（§5.0/§5.3） | `claySlab`×3 + `clayBlob`×6 | **一次都沒呼叫** |
| `track-surface` | 讀成**一塊平坦的算繪板**，不是壓出來的整塊黏土（§5.0/§5.4） | 已拆兩塊繞開 | 有，但套在 `PlaneGeometry` 上 |
| `track-barriers` | 重複的塊太均勻乾淨，讀不出手工接合（§5.0/§5.5） | 無 slab | 有（1 次） |

而 `src/render/clay/geometry.ts:144-159` 的 `applyHandPressedRelief()`
**明文拒絕 `claySlab()` 的產出**——因為它在 `RoundedBoxGeometry` 上算繪不出來，
R24 就發現了，「原因至今未查明」。

**所以：兩個被判「表面太平」的元件，主體正是 `claySlab`；而讓表面不平的
那支函式，對 `claySlab` 是設計上拒絕執行的。**

這不是巧合。那條從 R24 起就掛在 BACKLOG 上、被當成小怪癖的缺陷，
**現在被三個獨立 critic 從外部確認為擋住視覺 bar 的主要單一原因。**

弱佐證但方向一致：`track-barriers` 是唯一真的套到 relief 的元件，
也是唯一在某一輪拿到 4 分的元件。

## 四、這一輪不採信的東西

- **`driver-face` 的分數要打折看**。送出前量到它的主體只佔畫面最長邊 60%，
  是四組裡最低，而它恰好最吃微觀細節（見 `RUNS.md`）。
  它的 3 分裡有多少來自構圖、多少來自實作，這一輪分不出來。
- `§1.4` 的實景圖判讀三輪都說 `§5.3` 的笑口與大圓眼在車上看得到——
  但那是**第一次**有這張圖可判，沒有跨輪基準，這一輪只記錄不當結論。
