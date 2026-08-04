/**
 * 側面輪廓擠出——黏土造型的第二種積木。
 *
 * `geometry.ts` 的圓角塊適合方正的零件，但**車身這種一體成形的有機輪廓
 * 疊不出來**：R18 第一版把車身拿圓角塊跟球堆起來，成品讀起來是「一堆
 * 圓角基元」而不是一台車，跟參考圖那種連續起伏的甲蟲輪廓差很遠。
 *
 * 正確的做法是先畫側面剪影，再沿寬度方向擠出、邊緣倒角。這樣輪廓線是
 * 設計出來的，不是好幾塊的交集碰巧形成的。
 *
 * 倒角仍然遵守 `§6`：擠出的邊緣有 `bevelSize`／`bevelThickness`，且
 * `§5.0` 的「手捏邊」要求圓潤——這裡的預設值遠大於 `§6` 的 1.5% 下限。
 */
import { ExtrudeGeometry, Shape, type BufferGeometry } from 'three';
import { MIN_BEVEL_RATIO } from './geometry.js';

export interface ExtrudeProfileOptions {
  /** 擠出總寬度（含倒角）。 */
  width: number;
  /** 倒角尺寸。預設取寬度的一個手捏感比例。 */
  bevel?: number;
  /** 倒角細分。太低會看到稜線。 */
  bevelSegments?: number;
  /** 曲線細分。 */
  curveSegments?: number;
}

/**
 * 擠出件的預設倒角比例（相對寬度）。
 *
 * 0.17 對車身這種輪廓來說太大：倒角會把車頂、引擎蓋的轉折一起抹平，
 * 剪影退化成一座小山。0.12 仍遠高於 `§6` 的 1.5% 下限，手捏的圓潤感夠，
 * 但輪廓的設計意圖還留得住。
 */
const PROFILE_BEVEL_RATIO = 0.12;

/**
 * 把側面輪廓擠成一塊黏土。
 *
 * 輪廓用 `(forward, up)` 座標定義（x = 前後、y = 上下），回傳的幾何已經
 * 轉到專案慣例：forward = `+Z`、寬度沿 `±X`、原點在輪廓原點。
 */
export function extrudeProfile(
  shape: Shape,
  options: ExtrudeProfileOptions,
): BufferGeometry {
  const requested = options.bevel ?? options.width * PROFILE_BEVEL_RATIO;
  // §6 的倒角下限仍然適用；同時倒角不能大到把擠出深度吃光。
  const bevel = Math.min(
    Math.max(requested, options.width * MIN_BEVEL_RATIO),
    options.width * 0.45,
  );
  const depth = Math.max(options.width - bevel * 2, options.width * 0.1);

  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: options.bevelSegments ?? 4,
    curveSegments: options.curveSegments ?? 14,
  });

  // ExtrudeGeometry 沿 +Z 從 0 擠到 depth，倒角再往兩端各推 bevel，
  // 所以實際跨距是 `[-bevel, depth + bevel]`，中心在 `depth / 2`。
  // （寫成 `depth / 2 + bevel` 會多推一個 bevel，整塊偏向一側——R18 第一版
  // 就是這樣，車身歪掉半個倒角寬，另一側的貼片全被埋進殼裡看不見。）
  geometry.translate(0, 0, -depth / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * 小紅賽車的側面剪影。
 *
 * 依 `refs/clay/characters/小紅賽車.jpg`：圓鼓的前後保險桿、往上緩升的
 * 引擎蓋、陡起的前擋、短而拱的車頂、往後收的尾部。全部用二次曲線接，
 * 不留任何直角——黏土捏不出直角。
 *
 * 座標：x = 前後（+ 為車頭），y = 上下（0 為地面）。長度對齊
 * `CAR_LENGTH = 2.4`。
 */
export function xiaohongBodyProfile(): Shape {
  const shape = new Shape();

  // 車底前緣起手。
  shape.moveTo(0.86, 0.14);
  // 前保險桿：短而圓鼓，立刻收上去——甲蟲車鼻子短，拉長會變成跑車。
  shape.quadraticCurveTo(1.14, 0.15, 1.17, 0.40);
  // 引擎蓋前緣，轉折明確。
  shape.quadraticCurveTo(1.18, 0.56, 1.02, 0.62);
  // 短引擎蓋，緩升到前擋底。
  shape.quadraticCurveTo(0.78, 0.67, 0.56, 0.70);
  // 前擋風陡起——這個轉折要明顯，是甲蟲車的識別點之一。
  shape.quadraticCurveTo(0.42, 0.72, 0.30, 1.00);
  // 車頂前緣。
  shape.quadraticCurveTo(0.26, 1.12, 0.10, 1.14);
  // 車頂：略拱、大致居中偏後。
  shape.quadraticCurveTo(-0.18, 1.17, -0.34, 1.10);
  // 後窗下傾。
  shape.quadraticCurveTo(-0.50, 1.03, -0.62, 0.84);
  // 尾部甲板，比車頭高一點。
  shape.quadraticCurveTo(-0.78, 0.74, -0.98, 0.68);
  // 後保險桿：跟車頭一樣圓鼓。
  shape.quadraticCurveTo(-1.16, 0.62, -1.18, 0.38);
  shape.quadraticCurveTo(-1.19, 0.17, -0.94, 0.14);
  // 車底收回起點。
  shape.lineTo(0.86, 0.14);

  return shape;
}

/**
 * 數字「2」的輪廓。
 *
 * 第一版拿圓環 + 兩塊斜板拼，角度算錯，成品讀起來是「C」。改成直接畫
 * 一個粗筆畫「2」的封閉外框再擠出——輪廓是明確定義的，不是三塊東西
 * 疊出來碰運氣。
 *
 * 座標約在 `x ∈ [-0.09, 0.09]`、`y ∈ [-0.12, 0.12]`。
 */
export function numeralTwoProfile(): Shape {
  const shape = new Shape();

  // 底橫（外框下緣，由左至右）。
  shape.moveTo(-0.088, -0.118);
  shape.lineTo(0.09, -0.118);
  shape.lineTo(0.09, -0.058);
  // 底橫上緣往左回到斜筆起點。
  shape.lineTo(-0.004, -0.058);
  // 斜筆外側往右上。
  shape.quadraticCurveTo(0.052, 0.004, 0.088, 0.042);
  // 右上外緣轉上。
  shape.quadraticCurveTo(0.098, 0.098, 0.038, 0.12);
  // 頂弧外緣往左。
  shape.quadraticCurveTo(-0.03, 0.138, -0.072, 0.104);
  shape.quadraticCurveTo(-0.094, 0.084, -0.09, 0.046);
  // 內緣回來：左內側。
  shape.lineTo(-0.034, 0.042);
  shape.quadraticCurveTo(-0.032, 0.068, -0.006, 0.072);
  // 內頂弧。
  shape.quadraticCurveTo(0.026, 0.076, 0.036, 0.056);
  shape.quadraticCurveTo(0.044, 0.036, 0.02, 0.012);
  // 內側斜筆往左下，收回底橫左端。
  shape.quadraticCurveTo(-0.04, -0.05, -0.088, -0.086);
  shape.lineTo(-0.088, -0.118);

  return shape;
}
