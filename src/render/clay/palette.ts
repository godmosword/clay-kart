/**
 * 黏土配色 token。來源 `CHARACTERS.md §6`（從 Art Bible §4 複製），
 * 黃金樣本 `refs/clay/car-park.png` 為唯一真相。
 *
 * `BAR-VISUAL §5.0`：**顏色是材質本身（染色黏土），不是後製上色**——
 * 所以這裡的值直接餵給 material 的 color，不存在任何 tint/grade 圖層。
 *
 * `BAR-VISUAL §6` 全域禁令在本檔案的體現：
 * - 禁止純黑 `#000000` 與純白 `#ffffff`——最深的 `TIRE` 與最亮的
 *   `CREAM` 都刻意留了餘裕
 * - 禁止純螢光/高飽和——所有值都比對應純色去飽和約 10–20%
 */

/** 環境／地形，`CHARACTERS.md §6` 第一張表。 */
export const TERRAIN = {
  islandSand: 0xead7ac,
  grassLight: 0xc4e59a,
  grassMid: 0xa0c96a,
  grassDark: 0x7fae54,
  path: 0xd7c596,
  pond: 0xa9d8ee,
  seaLight: 0xcfe8f3,
  seaMid: 0xbfe0ef,
  seaDeep: 0xa7d2e8,
  /** 接地陰影，低不透明、柔。`§5.0` 要求短柔低對比。 */
  contactShadow: 0x6b5a48,
} as const;

/** car-park 車車樂園主題色，`CHARACTERS.md §6` 第二張表。 */
export const CAR_PARK = {
  brandOrange: 0xff8c2b,
  accentPink: 0xf7a8c4,
  accentYellow: 0xffd866,
  accentGreen: 0xb7df9b,
  accentBlue: 0x8fcde8,
  accentLavender: 0xc5b3e6,
} as const;

/**
 * 小紅賽車（`CHARACTERS.md §2` #1，玩家預設）。
 *
 * 取自 `refs/clay/characters/小紅賽車.jpg` 的目測近似值，並依 `§5.0`
 * 「比純色去飽和約 10–20%」再退一階——參考圖是照片風算圖，直接吸色會
 * 偏飽和。這裡刻意選比吸色結果再低一點的值，寧可偏粉彩也不要偏螢光。
 */
export const XIAOHONG = {
  /**
   * 車身主紅。不是 `#ff0000`，是帶土感的磚紅。
   *
   * 第一版用 `0xd94436`，算繪出來偏鮮豔、讀起來像塑膠玩具。`§5.0` 要的是
   * 「略帶粉彩、比純色去飽和約 10–20%」——染色黏土本身就不會有印刷級的
   * 飽和度。這一版把飽和度再退一階、明度略降，靠近參考圖的磚紅。
   */
  body: 0xc4544a,
  /** 車身側裙與底部收邊的深藍。同樣退一階飽和。 */
  skirt: 0x40679c,
  /** 號碼牌／賽車條紋的奶油白。刻意不是純白（`§6` 禁令）。 */
  cream: 0xf0e4cd,
  /** 號碼與窗框的藍。 */
  numberBlue: 0x3a5f96,
  /** 車窗玻璃——黏土世界不做透明玻璃，是一片淺藍黏土。 */
  glass: 0x9dc0d6,
  /** 頭燈的黃。 */
  headlight: 0xe8c66a,
  /** 尾翼／後視鏡的橘紅，比車身略暖一階。 */
  spoiler: 0xcf6248,
} as const;

/** 輪胎（`BAR-VISUAL §4` 元件 #2 `kart-wheels`）。 */
export const TIRE = {
  /** 不是純黑（`§6` 禁令），是很深的暖灰。 */
  rubber: 0x3a3330,
  rim: 0xf0e4cd,
  /** 輪轂中心，跟車身同一支紅。 */
  hub: 0xc4544a,
} as const;

/**
 * 臉（`BAR-VISUAL §4` 元件 #3 `driver-face`）。
 *
 * `CHARACTERS.md §4`：「**大圓眼 + 明確笑口**是全卡司共通識別，任何角度
 * 都要看得到眼睛」——所以眼白與瞳孔的明度差要夠，不能為了粉彩而拉平。
 */
export const FACE = {
  /** 臉盤底色，比車身奶油白再亮一點點。 */
  panel: 0xf7efe0,
  /** 眼白。刻意不是純白（`§6` 禁令）。 */
  eyeWhite: 0xfbf6ec,
  /** 虹膜的深藍。 */
  iris: 0x2b4f86,
  /** 瞳孔。深棕而非純黑——`§6` 禁純黑，而且黏土本來就沒有純黑。 */
  pupil: 0x241c1a,
  /** 眼神光。 */
  highlight: 0xfdfbf6,
  /** 嘴。跟瞳孔同一支深棕，保持五官色系一致。 */
  mouth: 0x241c1a,
  /** 舌頭的粉。 */
  tongue: 0xe08a92,
} as const;

/**
 * `§3` 拍攝規範的中性灰背景。
 * **不得逐元件更動**——所有元件圖必須在同一組條件下渲染。
 */
export const STAGE_BACKGROUND = 0x8a8a8a;
