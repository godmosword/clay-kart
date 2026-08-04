/**
 * 黏土材質工廠。**全 12 元件共用這一份**，不允許逐元件另做一套。
 *
 * `BAR-VISUAL §5.0` 的材質條款（Art Bible §3 原文）：
 * - 霧面油土/聚合黏土：高粗糙度、無玻璃/金屬光澤、無銳利反光
 * - 顏色是材質本身（染色黏土），不是後製上色
 *
 * `BAR-VISUAL §6` 的全域禁令在這裡是**用程式強制**的，不是靠註解提醒：
 * `metalness` 恆為 0、`roughness` 夾在下限之上、純黑純白會被推離端點。
 * 理由跟 R16 修 perf-probe 同一個：寫在文件裡但沒有機制擋的規則，
 * 遲早會有人（包括我自己）在趕工時繞過去。
 */
import { Color, MeshStandardMaterial } from 'three';
import { getClayTextures } from './texture.js';

/** `§6`：roughness 下限 0.45。實際黏土遠比這粗，這只是防呆下限。 */
export const MIN_ROUGHNESS = 0.45;

/** 霧面油土的預設粗糙度。接近全霧面，只留極微弱的大面積柔光。 */
const DEFAULT_ROUGHNESS = 0.92;

/**
 * 法線強度。壓痕要看得出來但不能搶戲。
 *
 * 第一版設 0.42 且貼圖重複 3.2，結果壓痕在成品圖上**完全看不見**——
 * 渦紋在 512² 貼圖裡半徑約 34–64px，重複 3.2 次之後每個渦紋只有約 0.02
 * 世界單位，比一個像素還小。`§6` 要求的「指紋與工具壓痕」等於沒做到，
 * 表面因此讀起來像塑膠。現在特徵尺度放大、強度拉高到看得見為止。
 */
const DEFAULT_NORMAL_SCALE = 0.9;

/** `§6` 禁止純黑 `#000000` 與純白 `#ffffff`，這是推離端點的餘裕。 */
const PURE_LIMIT = 0.04;

/**
 * 貼圖重複密度。壓痕大小要跨元件一致，否則尺度會亂掉。
 *
 * 1.0 = 整張貼圖鋪滿一個面。以 2.4 世界單位長的車身來說，一個渦紋約
 * 0.16–0.3 單位——大約是「手指按在黏土上」該有的尺度。
 */
const TEXTURE_REPEAT = 1;

export interface ClayMaterialOptions {
  /** 染色黏土的顏色。會被 `§6` 的純黑/純白禁令夾住。 */
  color: number;
  /** 覆寫粗糙度。仍會被夾在 `MIN_ROUGHNESS` 之上。 */
  roughness?: number;
  /** 覆寫法線強度。想讓某個元件的壓痕更明顯/更淡時用。 */
  normalScale?: number;
  /** 貼圖重複倍率，相對 `TEXTURE_REPEAT`。大件用大值避免壓痕被拉伸。 */
  textureScale?: number;
}

/**
 * 把顏色推離純黑與純白。`§6` 禁的是端點值本身——這裡不做色相調整，
 * 只在明度端點各留一點餘裕，維持「顏色是材質本身」的原則。
 */
function clampAwayFromPure(color: number): Color {
  const result = new Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  result.getHSL(hsl);
  const clampedL = Math.min(1 - PURE_LIMIT, Math.max(PURE_LIMIT, hsl.l));
  if (clampedL !== hsl.l) result.setHSL(hsl.h, hsl.s, clampedL);
  return result;
}

/**
 * 建立一份黏土材質。
 *
 * 每次呼叫回傳新的 material 實例（不同元件要不同顏色），但**貼圖是共用
 * 單例**——這是 `BAR-PERF §5.5` 材質記憶體控制的關鍵：12 個元件、
 * 數十個 material，全部指向同兩張 512² 貼圖。
 */
export function createClayMaterial(options: ClayMaterialOptions): MeshStandardMaterial {
  const repeat = TEXTURE_REPEAT * (options.textureScale ?? 1);
  const { normalMap, roughnessMap } = getClayTextures(repeat);

  const material = new MeshStandardMaterial({
    color: clampAwayFromPure(options.color),
    // §6 硬性：金屬度恆為 0。不接受覆寫，黏土沒有金屬。
    metalness: 0,
    roughness: Math.max(MIN_ROUGHNESS, options.roughness ?? DEFAULT_ROUGHNESS),
    normalMap,
    roughnessMap,
    // §5.0「只能有極微弱的大面積柔光」——環境反射壓到很低。
    envMapIntensity: 0.18,
  });

  material.normalScale.set(
    options.normalScale ?? DEFAULT_NORMAL_SCALE,
    options.normalScale ?? DEFAULT_NORMAL_SCALE,
  );
  material.userData.textureRepeat = repeat;

  return material;
}

/**
 * 驗證「`violatesGlobalBans()` 本身抓得到違規」。
 *
 * R16 修 `perf-probe` 的教訓：**一個永遠回報通過的檢查，跟沒有檢查是一樣
 * 的**。`createClayMaterial()` 會把參數夾到合法範圍，所以正常路徑根本造不
 * 出違規材質——那也代表「零違規」這個結果本身不構成證據。這裡刻意繞過
 * 工廠、直接構造四種違規材質，確認稽核真的會叫。
 *
 * 回傳測試案例數；抓不到任何一種就拋錯。
 */
export function selfTestGlobalBanAuditor(): number {
  const cases: ReadonlyArray<readonly [string, MeshStandardMaterial]> = [
    ['metalness', new MeshStandardMaterial({ metalness: 1, roughness: 0.9, color: 0x888888 })],
    ['roughness', new MeshStandardMaterial({ metalness: 0, roughness: 0.1, color: 0x888888 })],
    ['pure black', new MeshStandardMaterial({ metalness: 0, roughness: 0.9, color: 0x000000 })],
    ['pure white', new MeshStandardMaterial({ metalness: 0, roughness: 0.9, color: 0xffffff })],
  ];
  const missed = cases
    .filter(([, material]) => violatesGlobalBans(material).length === 0)
    .map(([label]) => label);
  if (missed.length > 0) {
    throw new Error(`§6 auditor failed to flag: ${missed.join(', ')}`);
  }
  return cases.length;
}

/**
 * `§6` 全域禁令的機器可讀檢查。給測試用，也給之後的驗證器用——
 * 「規則有沒有被遵守」應該是可以跑出來的，不是靠人看。
 */
export function violatesGlobalBans(material: MeshStandardMaterial): string[] {
  const violations: string[] = [];
  if (material.metalness !== 0) {
    violations.push(`metalness must be 0, got ${material.metalness}`);
  }
  if (material.roughness < MIN_ROUGHNESS) {
    violations.push(`roughness must be >= ${MIN_ROUGHNESS}, got ${material.roughness}`);
  }
  const hsl = { h: 0, s: 0, l: 0 };
  material.color.getHSL(hsl);
  if (hsl.l < PURE_LIMIT || hsl.l > 1 - PURE_LIMIT) {
    violations.push(`colour lightness ${hsl.l} is too close to pure black/white`);
  }
  if (hsl.s > 0.92) {
    violations.push(`colour saturation ${hsl.s} reads as fluorescent`);
  }
  return violations;
}
