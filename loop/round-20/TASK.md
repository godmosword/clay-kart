# R20 — W3：黏土地基接進遊戲 + 12 組參考半邊裁決 + `§5.1–§5.12`

**Wave:** W3
**Owner:** Lead（`clay-kart`，分支 `claude/codebase-progress-review-wvj70v`）
**前一輪:** R19——`kart-wheels` + `driver-face` 已合併進 main（`a497be8`）

---

## 為什麼這一輪是這三件事

R19 收尾時 W3 有兩個互相咬住的缺口：

1. **12 個元件做了 3 個，但一個都沒被評過分。** `BAR-VISUAL §1` 的盲測 A/B 需要
   參考半邊，`contact-sheet.manifest.json` 的 12 個 `ref` 從 R17 起全是 `null`
   （Cursor 依 `LOOP-OPS §4.4` 停手，寫進 BACKLOG 等 Lead 裁決）；`§5.1–§5.12`
   的個別條款也還沒寫。critic 跑不起來，所以「元件做完了」這句話目前沒有任何
   驗收依據撐著——`VERDICT-perf.json` 只證明沒有效能退化。

2. **地基沒接進遊戲。** R18/R19 兩輪都明文「這輪不接線」，理由是回歸來源要分得
   清楚。合理，但連續兩輪之後的後果是：`BAR-PERF` 量到的一直是 W1 方塊車，
   黏土的真實成本完全沒有資料；而且元件在拍攝台上好看，不代表裝到車上好看。

兩件事互為前提的部分不多，但都卡在「沒有人做 Lead 才能做的裁決」。這一輪把裁決
做掉，並且**接線與量測一起做**——接線的價值有一半在於量出真實成本，分兩輪做的話
第一輪等於沒有結論。

## 這輪做了什麼

### 1. `BAR-VISUAL §5.1–§5.12` 個別條款（Lead 專屬檔案）

12 個元件逐一補上**材質 / 色 / 比例 / 一眼判斷**四段式條款。依據是黃金樣本
`car-park.png`、`refs/clay/characters/*.jpg`，以及 R18/R19 的實際產出——
先有產出再寫條款，寫出來的才是可判的。

`§5.3 driver-face` 特別加了一條：**笑口必須在正面看得到，裝到車上被擋住也算沒做到**。
這條是這輪接線時實測發現的（見下方「已知缺口」），不是憑空補的。

### 2. 12 組參考半邊裁決（`BAR-VISUAL §7.1` + `tools/visual/ref-pairing.json`）

**10 組配對、2 組暫緩。** 判準與逐項理由寫在 `BAR-VISUAL.md §7.1`，機器要用的
座標寫在 `tools/visual/ref-pairing.json`。

三條硬判準（`§7.1`）：合 `§5.0`／`§6`；元件主體佔畫面主要面積；來源邊長足以
支撐 512²（放大上限 1.4×，超過直接失敗，不交糊圖）。

`item-boxes` 與 `ui-hud` 暫緩——`refs/clay` 真的沒有可用素材，唯一的箱體候選
（恐龍車多多的糖果）有明顯鏡面反光，違反 `§6`。**拿違反禁令的圖當標準，得到的
分數比沒有分數更糟。**

新增 `tools/visual/ref-tiles.mjs` 把裁決算成 512² 正規化半邊（裁切、alpha 壓平到
`#8a8a8a`、放大上限）。裁切這一步放在新腳本裡，`contact-sheet.mjs`（ck-plumb 在
R17 建立）一行都不用改——共用目錄不代表可以互改（R18 裁決）。

### 3. 黏土地基接進遊戲（`src/render/`、`src/characters/`）

- 新增 `src/render/components/kart.ts`：`kart-body` + `kart-wheels` + `driver-face`
  組成一台車，並把 `CHARACTERS.md §3` 的兩種更新率分流在同一個地方（車體/輪子
  60fps、臉 12fps，量化仍只實作在 `driver-face` 內部）
- `kart-wheels.ts` 的 `createKartWheelSet()` 改回傳帶 `setSpin()`／`setSteer()`
  的物件（原本回傳裸 `Group`，零呼叫端），轉向與自轉分兩層 `Group`
- `kart-body.ts` 加 `bodyColor` 選項：場上多台車要分得出哪台是自己的。
  **其餘五位車手是各自的造型，不是換色的小紅賽車**，這只是造型做出來之前的識別手段
- `renderer.ts`：方塊車換成整車、`HemisphereLight` 換成 `clay/lighting.ts` 的全域
  鑽機、賽道/草地/護欄換成共用黏土材質與 `CHARACTERS.md §6` 的色票
- 光照鑽機每幀跟著玩家平移。**這不是逐元件調光**（`§3` 禁的是那個），燈的參數一個
  都沒動；不跟著移動的話陰影 frustum（±9 單位）在車開離原點後就框不到車
- 新增 `tools/visual/game-shot.mjs`：拍**真的跑起來的遊戲**。元件拍攝台證明不了
  裝上車之後長什麼樣，這一輪就是靠它發現臉的缺口與轉向反向

## 這輪不做什麼

- **不做其餘 9 個元件。** 賽道/護欄/草地只換材質與色票，幾何完全沒動，
  `registry.ts` 裡仍然是 `create: null`——換材質不等於做完元件
- **不改 `src/physics/` 與 `src/ui/`。** 這輪發現的轉向反向缺陷落在那兩個目錄，
  不是 Lead 順手改的地方（見 BACKLOG）
- **不改 `driver-face` 的造型。** 笑口被擋住是元件層級問題，跟接線混在同一輪
  會讓回歸來源分不清

## 驗證（全部自己重跑，不信任既有 artifact）

- `npm run typecheck`、`npm run build`：exit 0
- `render-components.mjs`：3 個元件重拍，`§6` 稽核 17 個材質 0 違規、
  self-test 4 案例仍有效
- `ref-tiles.mjs`：10 組產出，放大上限確實會擋（`shadows-contact` 第一版
  座標越界、被腳本擋下並修正）
- `contact-sheet.mjs`：12 格產出正常，3 組（已實作的三個元件）現在是真的
  ref↔ours 配對，其餘走 placeholder
- `game-shot.mjs`：遊戲三張截圖，見 `artifacts/shots/`
- `perf-probe.mjs`：**FAIL**，逐項見 `VERDICT-perf.json`，成因分析見下

## perf：這輪的主要發現

同一台機器、同一支 probe、三種設定：

| 設定 | fps_p50 | fps_p05 | frame_time_p99 | draw_calls | triangles_k |
|---|---|---|---|---|---|
| W1 方塊車（接線前） | 51.81 | 31.48 | 39.8ms | 5 | 3.3 |
| 黏土車，關陰影 | 14.01 | 7.50 | 141.0ms | 62 | 41.1 |
| 黏土車，開 VSM 陰影 | **1.17** | **0.70** | **1680.6ms** | 122 | 76.5 |

artifacts：`perf-baseline-boxcar.json`／`perf-clay-noshadow.json`／`perf-proxy.json`。

拆開來看：

- **黏土材質與幾何本身約 3.7×**（51.8 → 14.0）。`MeshStandardMaterial` + 法線貼圖
  + 粗糙度貼圖取代 `MeshLambertMaterial`，加上 60 個 mesh 取代 1 個方塊
- **VSM 陰影再 12×**（14.0 → 1.17）。這是主導成本，不是材質。2048² 陰影貼圖 +
  16 取樣模糊，在軟體光柵化下極貴

**這個數字不能直接當「遊戲太慢」的結論。** 本輪的量測環境是容器內的 SwiftShader
軟體算繪，沒有 GPU；同一支 probe 在這台機器上量 W1 方塊車只有 51.8fps，而 R19 在
原本的機器上量到 59.88fps——**跨機器的絕對值不可比，只有同機器的相對值可比**。
`BAR-PERF` 的 probe 本來就自我標註為 proxy（`device_note`）。

可以確定的是：**陰影設定是首要的優化對象**，而且這件事在接線之前完全看不到——
拍攝台一次只算一個元件、一張 512² 圖，量不到這個。

## 追加：轉向反向已修正（同一輪）

發現當下寫成「待裁決」，理由是修正點不在 Lead 的寫入範圍。裁決之後改為當輪修掉，
關鍵是**修哪一層**：

第一版契約把 `steer` 定義成「`steer > 0` = 畫面往右」，那樣讀起來直覺，但代價是
`src/physics/world.ts` **與 `src/ai/controller.ts` 同時違規**——`controller.ts` 的
`steer = clamp(yawError / STEER_ERROR_RANGE)` 本來就把 steer 當成「要把 yaw 改多少」，
翻符號會讓每台 AI 車往目標的反方向轉，`BAR-FEEL §12.1`–`§12.4`（R15 全數 PASS）
整組垮掉。

所以規範定義改釘在模擬側（**`steer > 0` 使 yaw 增加**），畫面左右交給 `src/ui/`
翻譯——輸入層本來就是把玩家意圖翻成模擬輸入的那一層。修正因此是
`player-input.ts` 的兩個具名常數，`src/physics/`、`src/ai/` 一行未動。

驗證：`shots/game-hold-right-fixed.png`（按住 →）車偏內側、
`shots/game-hold-left-fixed.png`（按住 ←）車偏外側，正好是修正前兩張的鏡像；
`BAR-FEEL` 重跑 42/46 PASS，FAIL 的仍是 `4.4`/`4.6`/`4.7`/`4.10` 那四個自 R5
擱置的 drift 次要項目，數值與 R15 相同（`VERDICT-feel.json`）。

## 追加：陰影參數掃描（同一輪）

上面那張表指出主導成本是陰影，所以直接把設定掃過一遍。同機器同 probe：

| 貼圖 / 取樣 | fps_p50 | 畫面差異 |
|---|---|---|
| 2048 / 16（R18 原設定） | 約 0.8–1.2 | 基準 |
| 1024 / 8 | 3.19 | 看不出來 |
| **512 / 4（採用）** | **約 6.3** | 看不出來 |
| 陰影全關（上限參考） | 14.01 | 失去自體遮蔽，非可採用設定 |

**2048/16 買到的東西是零。** 接地陰影只佔畫面很小一塊，`±9` 單位的陰影 frustum
除以 512 仍有約 3.5cm/texel；貼圖解析度是拿來換銳利度的，而 `§5.0` 明文不要銳利。
並排截圖見 `artifacts/shadow-sweep/_compare-2048-1024-512.png`。

重複性：同設定連跑三次 `fps_p50` 為 6.25 / 5.87 / 6.85（±8%），倍率差異遠大於
雜訊。但 `fps_p05` 與 `frame_time_p99` 在這個環境雜訊很大（低幀率下取樣數太少），
`summary.json` 已註明不適合拿來比較設定之間的差異。

即時投影就算調到 512/4 仍佔掉一半以上的幀時間。**要不要改用貼片取代即時投影，
留給元件 #10 `shadows-contact`**——那不是效能取捨而已，是「用貼片換掉自體遮蔽
划不划算」，得看得到兩種做法的並排圖才能判斷。上限 14.0 fps 給那一輪當參考。

## 完成的定義

- [x] `BAR-VISUAL §5.1–§5.12` 12 條全數補齊
- [x] 12 組參考半邊裁決完成（10 配對 / 2 暫緩，理由逐項寫明）
- [x] 黏土地基接進遊戲，`typecheck`／`build` exit 0
- [x] `§6` 稽核仍 0 違規
- [x] perf 重跑並拆解成因，FAIL 如實記錄
- [x] 接線後發現的缺陷全數寫進 `loop/BACKLOG.md`
