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
  const geometry = new RoundedBoxGeometry(
    width,
    height,
    depth,
    options.segments ?? BEVEL_SEGMENTS,
    radius,
  );
  // 來源標記。`applyHandPressedRelief()` 靠它拒絕這種 geometry——理由見那支
  // 函式的守衛註解。標在來源比在下游猜 `geometry.type` 可靠：
  // `RoundedBoxGeometry` 繼承 `BoxGeometry`，type 欄位認不出來。
  geometry.userData.clayPrimitive = 'slab';
  return geometry;
}

/**
 * 圓潤團塊——用在本來就該是渾圓的部位（擋泥板隆起、後視鏡球）。
 * 球體本身沒有邊可以倒角，`§6` 的倒角條款對它自然成立。
 */
export function clayBlob(radius: number, segments = 20): BufferGeometry {
  return new SphereGeometry(radius, segments, Math.max(8, Math.round(segments * 0.6)));
}

/**
 * 手壓起伏：沿法線做低頻位移，讓大面積表面不是數學平面。
 *
 * **為什麼平面需要這個而車身不需要**：法線貼圖靠的是表面朝向與光的夾角
 * 變化。車身各個面朝向都不同，壓痕吃得到光；而一塊水平躺著、頭上是
 * `§5.0` 要求的「柔和大面積、弱方向性」主光的路面，整片的入射角幾乎一樣，
 * 法線貼圖幾乎不產生明暗差——算出來就是一片死平的色塊，也就是 `§5.4`
 * 一眼判斷要排除的「貼上去的一張材質」。
 *
 * 真的被手壓平的一大塊黏土本來就不是平面，它有很淺的波浪。做成幾何而不是
 * 加強法線貼圖，是因為只有幾何會同時出現在**側視輪廓**與**接縫的陰影**裡，
 * 而那兩樣正是「壓平的一塊」讀得出來的地方。
 *
 * 位移量以世界座標取樣，所以同一塊地形不管切成幾片、用什麼 geometry，
 * 起伏都對得起來，不會在接縫處錯開。
 *
 * 確定性：用整數哈希的 value noise，**沒有 `Math.random()`**——元件審查圖
 * 必須可以重複產生，`loop/round-21` 那次「與 R19 差異最大 11」的比對
 * 靠的就是這件事。
 */
export interface HandPressedReliefOptions {
  /** 位移振幅（世界單位）。路面約 0.02，草地可以大一點。 */
  amplitude: number;
  /** 主波長（世界單位）。預設對齊壓痕的基準尺度。 */
  wavelength?: number;
  /** 物件在世界中的位移，讓相鄰物件的起伏能接上。 */
  offset?: { x: number; z: number };
  /**
   * 只往正向位移（0..amplitude），不往下凹。
   *
   * 用在「薄表面疊在一塊實心板上」的情況：往下凹會沉進板子裡，凹處露出的是
   * 板子平坦的頂面，起伏因此在最需要它的地方消失。往上推也比較接近實情——
   * 黏土被壓棒推過，留下的是凸起的稜，不是挖出來的溝。
   */
  positiveOnly?: boolean;
}

function hash2(ix: number, iz: number): number {
  // 整數哈希，回傳 [0, 1)。常數取自常見的 xorshift 混合，無特殊意義。
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  // smoothstep，避免格點處出現折線
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const n00 = hash2(ix, iz);
  const n10 = hash2(ix + 1, iz);
  const n01 = hash2(ix, iz + 1);
  const n11 = hash2(ix + 1, iz + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return (nx0 + (nx1 - nx0) * sz) * 2 - 1;
}

/** 就地位移 geometry 的頂點並重算法線。回傳同一個 geometry 方便串接。 */
export function applyHandPressedRelief(
  geometry: BufferGeometry,
  options: HandPressedReliefOptions,
): BufferGeometry {
  // **`claySlab()` 的產出不吃這個位移，直接拒絕。**
  //
  // R24 做 `track-surface` 時撞到：同一支函式套在 `PlaneGeometry` 上正常
  // （成品圖的 sd/mean 從 1.98 變 9.19），套在 `claySlab()` 的
  // `RoundedBoxGeometry` 上算繪出來**完全看不到**——振幅從 0.038 加到 0.25
  // （6.5 倍）、`segments` 從 40 改到 6，輸出逐位元相同，側視輪廓是一條直線。
  //
  // **失效不在幾何層。** R25 試過用「位移後包圍盒有沒有變」當守衛，實測那組
  // 參數的包圍盒確實變化 0.031（振幅 0.25），守衛根本不會觸發——位移確實寫進
  // 了 `position`，看不到的是算繪結果。原因至今未查明。
  //
  // 所以改成拒絕來源：我們不知道為什麼，但知道**這條路徑不行**。想在圓角塊體
  // 上做起伏的話，拆成「厚度板 + 轉平的 `PlaneGeometry` 表面」——那在幾何上
  // 本來也比較對（可見表面該是一張夠密的網格，而不是為了 12 個看不到的側面
  // 頂點付整塊的細分成本）。`track-surface` 就是這樣做的。
  if (geometry.userData?.clayPrimitive === 'slab') {
    throw new Error(
      'applyHandPressedRelief 不支援 claySlab() 的產出（RoundedBoxGeometry）：'
      + '位移會寫進 position 但算繪不出來，原因未查明（見 loop/BACKLOG.md）。'
      + '改用「厚度板 + 轉平的 PlaneGeometry 表面」，參考 components/track-surface.ts。',
    );
  }

  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  if (!position || !normal) return geometry;

  const wavelength = options.wavelength ?? 2.4;
  const offsetX = options.offset?.x ?? 0;
  const offsetZ = options.offset?.z ?? 0;

  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i);
    const py = position.getY(i);
    const pz = position.getZ(i);
    const wx = (px + offsetX) / wavelength;
    const wz = (pz + offsetZ) / wavelength;
    // 兩個八度：低頻是「壓平時留下的波浪」，高頻是壓棒走過的痕。
    const noise =
      valueNoise2(wx, wz) * 0.72 + valueNoise2(wx * 2.7, wz * 2.7) * 0.28;
    const displacement =
      (options.positiveOnly ? noise * 0.5 + 0.5 : noise) * options.amplitude;
    position.setXYZ(
      i,
      px + normal.getX(i) * displacement,
      py + normal.getY(i) * displacement,
      pz + normal.getZ(i) * displacement,
    );
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
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
