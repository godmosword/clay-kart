/**
 * 程序生成的黏土表面紋理。
 *
 * `BAR-VISUAL §6` 的禁令是這整份檔案存在的理由：
 *
 * > 禁止程序化雜訊直接當表面細節 —— 要的是指紋/壓棒痕，不是 noise texture
 * > （兩者的差別：指紋有方向性與局部聚集，noise 是均勻隨機。後者一看就是塑膠）
 *
 * 所以這裡不是「加一層 noise」。實際生成三種有結構的特徵：
 *
 * 1. **指紋渦紋**——同心橢圓脊線，有明確的局部方向（每個渦紋自己的旋轉角）
 *    與局部聚集（渦紋中心成群分佈，不是均勻灑點）
 * 2. **壓棒拖痕**——沿單一方向的平行脊線，限制在一個柔邊長橢圓遮罩內
 * 3. **零星小坑與棉絮**——`§5.0` 明文要的「零星小坑與棉絮感」
 *
 * 底下墊一層極低振幅的細顆粒。**那層才是 noise**，但它是基底不是表面細節，
 * 對應真實油土的粉質感；把它拿掉會讓渦紋看起來像浮貼在塑膠上。
 *
 * 全部特徵都用環形（toroidal）距離計算，所以貼圖可以無縫 repeat——
 * 黏土表面是有機的，接圖縫會一眼看出來。
 *
 * 生成是**決定性**的（種子固定），同一份 build 每次跑出來的紋理一樣。
 */
import {
  DataTexture,
  LinearMipmapLinearFilter,
  LinearFilter,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three';

/** 貼圖邊長。全 12 元件共用同一份，不是每個元件各一張——見 BAR-PERF §5.5。 */
const SIZE = 512;

/** 決定性 PRNG（mulberry32）。同種子必然同結果。 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 環形差值：讓所有特徵跨越貼圖邊界時從對側接回來，貼圖才能無縫 repeat。 */
function wrapDelta(a: number, b: number, size: number): number {
  let d = a - b;
  if (d > size * 0.5) d -= size;
  if (d < -size * 0.5) d += size;
  return d;
}

/** 週期性 value noise 的格點雜湊——lattice 對 SIZE 取模，因此本身就無縫。 */
function latticeValue(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix & 0xffff, 0x27d4eb2d) ^ Math.imul(iy & 0xffff, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 對高度場的環形累加。索引已在呼叫端取模到範圍內，這裡的 `?? 0` 只是
 * 滿足 `noUncheckedIndexedAccess`，不是預期的執行路徑。
 */
function accumulate(height: Float32Array, x: number, y: number, delta: number): void {
  const index = y * SIZE + x;
  height[index] = (height[index] ?? 0) + delta;
}

/**
 * 週期性 value noise。`period` 必須整除 SIZE，否則接圖處會有縫。
 * 這是**基底粉質感**，不是表面細節——振幅刻意壓到很低。
 */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const scale = SIZE / period;
  const fx = (x / SIZE) * scale;
  const fy = (y / SIZE) * scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const wrap = (v: number) => ((v % scale) + scale) % scale;
  const x0 = wrap(ix);
  const x1 = wrap(ix + 1);
  const y0 = wrap(iy);
  const y1 = wrap(iy + 1);
  const v00 = latticeValue(x0, y0, seed);
  const v10 = latticeValue(x1, y0, seed);
  const v01 = latticeValue(x0, y1, seed);
  const v11 = latticeValue(x1, y1, seed);
  const top = v00 + (v10 - v00) * sx;
  const bottom = v01 + (v11 - v01) * sx;
  return top + (bottom - top) * sy;
}

interface Whorl {
  cx: number;
  cy: number;
  angle: number;
  aspect: number;
  radius: number;
  frequency: number;
  amplitude: number;
  phase: number;
}

interface Stroke {
  cx: number;
  cy: number;
  angle: number;
  length: number;
  width: number;
  frequency: number;
  amplitude: number;
}

interface Pit {
  cx: number;
  cy: number;
  radius: number;
  depth: number;
}

/**
 * 指紋渦紋的中心刻意**成群**產生：先灑少數幾個「手指按壓區」，再在每區
 * 周圍散佈數個渦紋。這就是 `§6` 說的「局部聚集」——均勻灑點會退化成 noise。
 */
function buildWhorls(random: () => number): Whorl[] {
  const whorls: Whorl[] = [];
  const clusterCount = 5;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const clusterX = random() * SIZE;
    const clusterY = random() * SIZE;
    // 同一次按壓留下的脊線方向大致一致，只有小幅擾動——這是「方向性」。
    const clusterAngle = random() * Math.PI * 2;
    const perCluster = 3 + Math.floor(random() * 3);
    for (let index = 0; index < perCluster; index += 1) {
      const spread = 26 + random() * 40;
      whorls.push({
        cx: clusterX + (random() - 0.5) * spread * 2,
        cy: clusterY + (random() - 0.5) * spread * 2,
        angle: clusterAngle + (random() - 0.5) * 0.7,
        aspect: 1.35 + random() * 0.5,
        radius: 34 + random() * 30,
        frequency: 0.42 + random() * 0.16,
        amplitude: 0.5 + random() * 0.35,
        phase: random() * Math.PI * 2,
      });
    }
  }
  return whorls;
}

/** 壓棒拖痕：單一方向的平行脊線，裝在柔邊長橢圓遮罩裡。 */
function buildStrokes(random: () => number): Stroke[] {
  const strokes: Stroke[] = [];
  const count = 9;
  for (let index = 0; index < count; index += 1) {
    strokes.push({
      cx: random() * SIZE,
      cy: random() * SIZE,
      angle: random() * Math.PI * 2,
      length: 55 + random() * 70,
      width: 13 + random() * 14,
      frequency: 0.5 + random() * 0.25,
      amplitude: 0.32 + random() * 0.22,
    });
  }
  return strokes;
}

/** `§5.0`「零星小坑與棉絮感」。刻意稀疏，多了會變成月球表面。 */
function buildPits(random: () => number): Pit[] {
  const pits: Pit[] = [];
  const count = 46;
  for (let index = 0; index < count; index += 1) {
    pits.push({
      cx: random() * SIZE,
      cy: random() * SIZE,
      radius: 1.6 + random() * 3.4,
      depth: 0.35 + random() * 0.5,
    });
  }
  return pits;
}

/**
 * 產生高度場。用 scatter（只走每個特徵的影響範圍）而不是 gather
 * （每個像素掃全部特徵）——後者在 512² × 數十個特徵會慢到影響
 * `BAR-PERF §3.4` 的首次算繪時間。
 */
function buildHeightField(seed: number): Float32Array {
  const random = mulberry32(seed);
  const height = new Float32Array(SIZE * SIZE);

  // 基底粉質感。兩個八度，振幅極低——它是墊底的，不是表面細節本身。
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const coarse = periodicNoise(x, y, 64, 0x9e3779b9) - 0.5;
      const fine = periodicNoise(x, y, 16, 0x85ebca6b) - 0.5;
      height[y * SIZE + x] = coarse * 0.16 + fine * 0.1;
    }
  }

  for (const whorl of buildWhorls(random)) {
    const reach = Math.ceil(whorl.radius) + 2;
    const cos = Math.cos(-whorl.angle);
    const sin = Math.sin(-whorl.angle);
    const minX = Math.floor(whorl.cx - reach);
    const minY = Math.floor(whorl.cy - reach);
    for (let dy = 0; dy <= reach * 2; dy += 1) {
      const py = minY + dy;
      for (let dx = 0; dx <= reach * 2; dx += 1) {
        const px = minX + dx;
        const ox = wrapDelta(px, whorl.cx, SIZE);
        const oy = wrapDelta(py, whorl.cy, SIZE);
        // 旋轉到渦紋自己的座標系，再壓成橢圓——指紋不是正圓。
        const rx = ox * cos - oy * sin;
        const ry = (ox * sin + oy * cos) * whorl.aspect;
        const distance = Math.hypot(rx, ry);
        if (distance > whorl.radius) continue;
        const falloff = smoothstep(whorl.radius, whorl.radius * 0.25, distance);
        if (falloff <= 0) continue;
        // 脊線沿著角度輕微起伏，避免看起來像同心圓的機械圖樣。
        const wobble = Math.sin(Math.atan2(ry, rx) * 3) * 0.9;
        const ridge = Math.sin(distance * whorl.frequency + whorl.phase + wobble);
        const wx = ((px % SIZE) + SIZE) % SIZE;
        const wy = ((py % SIZE) + SIZE) % SIZE;
        accumulate(height, wx, wy, ridge * falloff * whorl.amplitude);
      }
    }
  }

  for (const stroke of buildStrokes(random)) {
    const reach = Math.ceil(Math.max(stroke.length, stroke.width)) + 2;
    const cos = Math.cos(-stroke.angle);
    const sin = Math.sin(-stroke.angle);
    const minX = Math.floor(stroke.cx - reach);
    const minY = Math.floor(stroke.cy - reach);
    for (let dy = 0; dy <= reach * 2; dy += 1) {
      const py = minY + dy;
      for (let dx = 0; dx <= reach * 2; dx += 1) {
        const px = minX + dx;
        const ox = wrapDelta(px, stroke.cx, SIZE);
        const oy = wrapDelta(py, stroke.cy, SIZE);
        const along = ox * cos - oy * sin;
        const across = ox * sin + oy * cos;
        const mask = smoothstep(1, 0, Math.hypot(along / stroke.length, across / stroke.width));
        if (mask <= 0) continue;
        const ridge = Math.sin(across * stroke.frequency);
        const wx = ((px % SIZE) + SIZE) % SIZE;
        const wy = ((py % SIZE) + SIZE) % SIZE;
        accumulate(height, wx, wy, ridge * mask * stroke.amplitude);
      }
    }
  }

  for (const pit of buildPits(random)) {
    const reach = Math.ceil(pit.radius) + 2;
    const minX = Math.floor(pit.cx - reach);
    const minY = Math.floor(pit.cy - reach);
    for (let dy = 0; dy <= reach * 2; dy += 1) {
      const py = minY + dy;
      for (let dx = 0; dx <= reach * 2; dx += 1) {
        const px = minX + dx;
        const ox = wrapDelta(px, pit.cx, SIZE);
        const oy = wrapDelta(py, pit.cy, SIZE);
        const distance = Math.hypot(ox, oy);
        if (distance > pit.radius) continue;
        const falloff = smoothstep(pit.radius, 0, distance);
        const wx = ((px % SIZE) + SIZE) % SIZE;
        const wy = ((py % SIZE) + SIZE) % SIZE;
        accumulate(height, wx, wy, -falloff * pit.depth);
      }
    }
  }

  return height;
}

function normalizeInPlace(height: Float32Array): void {
  let min = Infinity;
  let max = -Infinity;
  for (const value of height) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min || 1;
  for (let index = 0; index < height.length; index += 1) {
    height[index] = (((height[index] ?? 0) - min) / range) * 2 - 1;
  }
}

function sample(height: Float32Array, x: number, y: number): number {
  const wx = ((x % SIZE) + SIZE) % SIZE;
  const wy = ((y % SIZE) + SIZE) % SIZE;
  return height[wy * SIZE + wx]!;
}

export interface ClayTextures {
  /** 表面壓痕的法線貼圖。強度由 material 的 normalScale 控制。 */
  normalMap: DataTexture;
  /**
   * 粗糙度微變化。真實黏土不會整片一樣粗——壓過的地方稍微光滑一點。
   * 值域刻意窄，`§6` 要求 roughness 下限 0.45，這張只做微調不做對比。
   */
  roughnessMap: DataTexture;
}

let cached: ClayTextures | null = null;
const repeatVariants = new Map<number, ClayTextures>();

/**
 * 取得指定重複密度的黏土貼圖組。
 *
 * **貼圖影像資料是全域單例**：`§5.0` 的鐵律是全場同一套材質語言，而
 * `BAR-PERF §5.5` 的材質記憶體上限是 96MB——12 個元件各生一張 512² 貼圖
 * 既違反前者也浪費後者。
 *
 * 不同元件需要不同的壓痕密度（大件不能把壓痕拉伸），所以這裡按 repeat
 * 值 clone。three.js 的 texture clone 共用同一個 `.source`，GPU 上仍是同
 * 一份影像，只有取樣參數各自獨立——記憶體不會隨變體數量增加。
 *
 * （早期版本改用 `onBeforeCompile` 注入 uv 縮放，但那會去寫 `vMapUv` 這種
 * 只在對應貼圖存在時才宣告的 varying，shader 編譯失敗、整台車不算繪。
 * clone 走的是 three.js 原生的 texture transform，沒有這個風險。）
 */
export function getClayTextures(repeat = 1): ClayTextures {
  const existing = repeatVariants.get(repeat);
  if (existing) return existing;

  const base = getBaseClayTextures();
  if (repeat === 1) {
    repeatVariants.set(1, base);
    return base;
  }

  const cloneWithRepeat = (texture: DataTexture): DataTexture => {
    const copy = texture.clone();
    copy.repeat.set(repeat, repeat);
    copy.needsUpdate = true;
    return copy;
  };

  const variant: ClayTextures = {
    normalMap: cloneWithRepeat(base.normalMap),
    roughnessMap: cloneWithRepeat(base.roughnessMap),
  };
  repeatVariants.set(repeat, variant);
  return variant;
}

function getBaseClayTextures(): ClayTextures {
  if (cached) return cached;

  const height = buildHeightField(0x1a7c);
  normalizeInPlace(height);

  const normalData = new Uint8Array(SIZE * SIZE * 4);
  const roughnessData = new Uint8Array(SIZE * SIZE * 4);
  // 法線的 z 分量固定，xy 由高度場的斜率決定。strength 只影響貼圖本身的
  // 對比，最終視覺強度仍由 material.normalScale 決定。
  const strength = 2.4;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const left = sample(height, x - 1, y);
      const right = sample(height, x + 1, y);
      const down = sample(height, x, y - 1);
      const up = sample(height, x, y + 1);
      const dx = (left - right) * strength;
      const dy = (down - up) * strength;
      const length = Math.hypot(dx, dy, 1);
      const index = (y * SIZE + x) * 4;
      normalData[index] = Math.round(((dx / length) * 0.5 + 0.5) * 255);
      normalData[index + 1] = Math.round(((dy / length) * 0.5 + 0.5) * 255);
      normalData[index + 2] = Math.round(((1 / length) * 0.5 + 0.5) * 255);
      normalData[index + 3] = 255;

      // 凸起處（被指腹壓過）稍微光滑，凹處稍微粗——幅度極小。
      //
      // 值必須落在 1.0 附近：three.js 是 `roughnessFactor *= texel.g`，
      // 也就是**乘上去**的。第一版把中心值放在 0.5，等於把 material 的
      // 0.92 直接砍半成 0.46，霧面油土因此變得半亮——正好違反 §5.0 的
      // 「無玻璃/金屬光澤」。
      const local = sample(height, x, y);
      const roughness = Math.round(Math.min(1, 0.94 - local * 0.06) * 255);
      roughnessData[index] = roughness;
      roughnessData[index + 1] = roughness;
      roughnessData[index + 2] = roughness;
      roughnessData[index + 3] = 255;
    }
  }

  const makeTexture = (data: Uint8Array): DataTexture => {
    const texture = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
    return texture;
  };

  cached = {
    normalMap: makeTexture(normalData),
    roughnessMap: makeTexture(roughnessData),
  };
  return cached;
}

/** 測試與工具用：拿到原始高度場，不經過貼圖編碼。 */
export function buildClayHeightFieldForInspection(seed = 0x1a7c): {
  size: number;
  height: Float32Array;
} {
  const height = buildHeightField(seed);
  normalizeInPlace(height);
  return { size: SIZE, height };
}
