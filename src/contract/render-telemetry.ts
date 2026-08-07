/**
 * 算繪端的更新計數契約（`BAR-PERF §4`）。
 *
 * **Lead 專屬目錄。** `src/render/`（ck-visual）負責遞增，
 * `tools/telemetry/perf-probe.mjs`（ck-physics）負責讀取——兩邊都不直接
 * 依賴對方的實作細節，只依賴這個檔案。
 *
 * ## 為什麼需要它
 *
 * `BAR-PERF §4` 是「違反即整輪 FAIL」的最高優先條款，防的是
 * 「builder 想做定格感，順手把整個 scene 都抽格了」。但到 R25 為止那道防線
 * 一直沒有真的在量它宣稱要量的東西：
 *
 * - **`4.2` / `4.3`**：`perf-probe.mjs` 把 `vehicle_transform_hz` 與
 *   `camera_hz` 都設成 `rendered_frames / elapsed`。量的是「算繪出了幾幀」，
 *   不是「transform 更新了幾次」。一個以 12Hz 更新 transform 但以 60Hz 算繪的
 *   場景會回報 60，照樣 PASS——正是要防的那件事（`BAR-PERF §4.4`）
 * - **`4.1`**：R25 改成真量測了，但做法是全域替換 `Math.floor`、對每次呼叫做
 *   `new Error().stack` 比對字串裡有沒有 `setExpressionTime`。**那是
 *   `driver-face.ts` 的方法名**——ck-visual 改個名字，ck-physics 的 `§4.1`
 *   就會壞掉，而兩邊都沒有機制知道對方依賴自己
 *
 * 兩個問題同一個根因：**沒有一個雙方都看得到的計數點**。
 *
 * ## 為什麼是計數不是頻率
 *
 * 這裡只累加次數，不算 Hz。頻率由探針用「兩次取樣之間的差 / 經過時間」算——
 * 算繪端不需要知道量測窗口有多長，也不需要持有時間戳。少一件事要同步。
 *
 * ## 效能約束
 *
 * `BAR-PERF §2.5` 要求主迴圈不得配置垃圾。這裡是**單一模組層級的可變物件**，
 * 欄位就地遞增，永遠不 new——跟 `src/loader/bootstrap.ts` 的 `timeStats`
 * 同一個做法。計數器永遠開著：`++` 的成本遠低於任何條件判斷的分支預測失敗，
 * 而關掉它就等於 `§4` 沒有量測來源。
 */

/** 算繪端每輪更新時遞增的計數器。欄位語意見各自註解。 */
export interface RenderTelemetry {
  /**
   * 算繪幀數。**分母。**
   *
   * 沒有它的話，`vehicleTransformUpdates / 經過時間` 算出來仍然等於算繪率——
   * 因為 transform 本來就是每幀寫一次。那會退回 `§4.2`/`§4.3` 原本的毛病：
   * 一台跑 22fps 的機器會回報 22，FAIL 的理由是「慢」而不是「抽格」，
   * 而 `§4` 要防的是後者。
   *
   * 有了分母，「有沒有抽格」變成 `updates / renderedFrames`，**該是 1.0**，
   * 且與機器快慢無關。`§4.1` 的角色動畫則該是 `12 / renderedFrames` 附近。
   */
  renderedFrames: number;

  /**
   * 載具 transform 實際被寫入的次數。**每台車每幀算一次**，不是每台車各算一次
   * ——`§4.2` 判的是「載具有沒有被抽格」，不是場上有幾台車。
   */
  vehicleTransformUpdates: number;

  /** 相機 transform 實際被寫入的次數。`§4.3`。 */
  cameraUpdates: number;

  /**
   * 角色動畫的**量化格**變化次數。`§4.1` 判的是 12fps 抽格有沒有生效，
   * 所以這裡要在「抽格後的格號真的改變」時才遞增——每幀都加會量到算繪率，
   * 那就退回 `4.2`/`4.3` 現在的毛病。
   */
  characterAnimationFrames: number;
}

/**
 * 全域單例。算繪端 import 它並就地遞增；探針從 `window` 讀。
 *
 * 不用 class、不用 getter：任何一層間接都是每幀數千次的呼叫。
 */
export const renderTelemetry: RenderTelemetry = {
  renderedFrames: 0,
  vehicleTransformUpdates: 0,
  cameraUpdates: 0,
  characterAnimationFrames: 0,
};

declare global {
  interface Window {
    /**
     * 給 `tools/telemetry/perf-probe.mjs` 讀。**永遠掛上**——`§4` 是
     * 「違反即整輪 FAIL」的條款，量測來源不能是選配的。
     */
    __CLAY_RENDER_TELEMETRY__?: RenderTelemetry;
  }
}

/** 在 bootstrap 時呼叫一次，把單例掛到 `window` 供探針讀取。 */
export function exposeRenderTelemetry(): void {
  if (typeof window === 'undefined') return;
  window.__CLAY_RENDER_TELEMETRY__ = renderTelemetry;
}
