/**
 * 黏土幾何基元。
 *
 * `BAR-VISUAL §5.0`：「**手捏邊**：所有邊角圓潤帶微倒角，半徑一致」
 * `BAR-VISUAL §6`：「所有可見邊緣須有倒角，半徑 ≥ 該元件最短邊的 1.5%」
 *
 * 1.5% 是**下限**不是目標。真的按 1.5% 做出來會像「稍微磨過的塑膠盒」，
 * 不像手捏黏土——參考圖 `refs/clay/characters/小紅賽車.jpg` 上幾乎找不到
 * 一條直角邊。所以預設走 `HAND_PRESSED_RATIO`，下限只是防呆。
 *
 * 用獨立的圓角塊拼出造型（而不是雕一個完整 mesh）也是刻意的：`§5.0` 的
 * 「**接縫**：不同塊黏土接合處留可見縫隙，強化『拼出來的模型』感」——
 * 重疊的獨立塊體本身就會產生那種接縫，這是美學要求不是實作妥協。
 */
import { BufferGeometry, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** `§6` 硬性下限：最短邊的 1.5%。 */
export const MIN_BEVEL_RATIO = 0.015;

/**
 * 手捏感的實際倒角比例。遠高於下限，這才是參考圖的樣子。
 *
 * 0.22 試出來仍然「像圓角盒子」而不是「手捏的」——參考圖上幾乎看不到
 * 平面接平面的稜線，塊體是鼓的。拉到 0.34 之後輪廓才開始有黏土的膨脹感。
 */
const HAND_PRESSED_RATIO = 0.34;

/** 圓角的細分段數。太低會看到多邊形稜線，破壞「圓潤」。 */
const BEVEL_SEGMENTS = 5;

export interface ClaySlabOptions {
  /** 覆寫倒角比例（相對最短邊）。仍會被夾在 `MIN_BEVEL_RATIO` 之上。 */
  bevelRatio?: number;
  segments?: number;
}

/**
 * 圓角塊體——黏土造型的主要積木。
 *
 * 倒角半徑由最短邊決定，所以同一個元件裡不同尺寸的塊體會有**視覺上
 * 一致**的圓潤感（`§5.0` 要求「半徑一致」）。
 */
export function claySlab(
  width: number,
  height: number,
  depth: number,
  options: ClaySlabOptions = {},
): BufferGeometry {
  const shortest = Math.min(width, height, depth);
  const requested = options.bevelRatio ?? HAND_PRESSED_RATIO;
  const ratio = Math.max(MIN_BEVEL_RATIO, requested);
  // RoundedBoxGeometry 的半徑不能到最短邊的一半，否則生成退化面。
  const radius = Math.min(shortest * ratio, shortest * 0.5 - 1e-4);
  return new RoundedBoxGeometry(
    width,
    height,
    depth,
    options.segments ?? BEVEL_SEGMENTS,
    radius,
  );
}

/**
 * 圓潤團塊——用在本來就該是渾圓的部位（擋泥板隆起、後視鏡球）。
 * 球體本身沒有邊可以倒角，`§6` 的倒角條款對它自然成立。
 */
export function clayBlob(radius: number, segments = 20): BufferGeometry {
  return new SphereGeometry(radius, segments, Math.max(8, Math.round(segments * 0.6)));
}

/**
 * `§6` 倒角條款的機器可讀檢查。
 *
 * 回傳這組尺寸的合法最小倒角半徑，呼叫端可以拿去對照自己實際用的值。
 * 跟 `material.ts` 的 `violatesGlobalBans()` 同一個用意：讓「有沒有守
 * 規則」是跑得出來的事實，不是靠讀 code review 判斷。
 */
export function minimumLegalBevel(width: number, height: number, depth: number): number {
  return Math.min(width, height, depth) * MIN_BEVEL_RATIO;
}
