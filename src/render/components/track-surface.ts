/**
 * `BAR-VISUAL §4` 元件 #4：`track-surface`——賽道路面材質與接縫。
 *
 * `§5.4` 四條的逐條對應：
 *
 * - **材質**「路面是一大塊壓平的黏土」→ 路面是一塊有厚度的板，不是零厚度的
 *   平面。零厚度看不到側面，而側面正是「壓平的一塊」與「貼上去的一張材質」
 *   的差別所在。
 * - **材質**「路面與草地的交界必須看得到接縫」→ 路面比草地高
 *   `SLAB_HEIGHT`，交界處因此有一圈真的立面與陰影，不是只有顏色換掉。
 *   `§5.0` 說接縫是「拼出來的模型」感的主要來源，那就得是幾何不是貼圖。
 * - **色**「步道 `#d7c596` 為主，邊緣可退到島緣奶油沙 `#ead7ac`」→
 *   `TERRAIN.path` 鋪面 + `TERRAIN.islandSand` 邊帶。**不用柏油灰。**
 * - **比例**「壓痕的世界尺度必須與車身一致」→ 這是本元件最容易做錯的一條，
 *   所以不用手調的 `textureScale`：環的 UV 直接用世界弧長算
 *   （見 `annulusWithWorldUv()`），平板則走 `pressRepeatFor()`。
 *
 * 車道虛線不在 `§5.4` 的條文裡，但配對的參考半邊（`§7.1` 第 4 組，
 * `鈴鈴清潔車.jpg` 右下路面）有。做成**另外壓上去的奶油色黏土條**而不是
 * 貼圖上的線——那同時滿足 `§5.0` 的接縫條款，也才是黏土世界裡標線該有的
 * 出處。畫上去的線會是「後製上色」，`§5.0` 明文禁止。
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  PlaneGeometry,
} from 'three';
import { applyHandPressedRelief, claySlab } from '../clay/geometry.js';
import { createClayMaterial, pressRepeatFor } from '../clay/material.js';
import { TERRAIN } from '../clay/palette.js';

/** 路面高出草地多少。夠深才有影子，太深會變成月台。 */
const SLAB_HEIGHT = 0.13;

/** 路面兩側的奶油沙邊帶寬度。 */
const SAND_EDGE_WIDTH = 0.55;

/**
 * 疊在路面上的東西（奶油沙邊帶、車道虛線）要抬到起伏的最高點之上。
 * `positiveOnly` 的起伏只往上長，第一版把邊帶放在 `SLAB_HEIGHT + 0.012`，
 * 振幅 0.085 的路面直接把它們吞掉——成品圖上邊帶與虛線整組消失。
 */
const OVERLAY_LIFT = 0.058;

/**
 * 手壓起伏。**振幅與波長要一起看**——決定表面能不能讀出來的是斜率
 * `振幅/波長`，不是振幅本身。
 *
 * 第一版設振幅 0.022、波長 2.4（沿用壓痕的基準尺度），算出來的最大傾角只有
 * `atan(2π·0.022/2.4) ≈ 3°`。在 `§5.0` 的柔和均勻光下 3° 幾乎不產生明暗差，
 * 成品圖跟完全沒做一模一樣——診斷時把振幅拉到 0.35 才第一次看見變化，
 * 證實位移有生效、只是斜率不足。
 *
 * 現在波長縮到「一個手指壓下去」的尺度，斜率約 12–18°，讀得出來但不會
 * 變成波浪板。`§5.4` 要的是「一大塊壓平的黏土」——壓平的東西有淺波浪，
 * 不是數學平面。
 */
const RELIEF = {
  road: { amplitude: 0.05, wavelength: 0.45, positiveOnly: true },
  grass: { amplitude: 0.075, wavelength: 0.55 },
} as const;

/**
 * 大面積水平面的法線強度。
 *
 * 預設 0.9 是為車身調的：車身各面朝向不同，壓痕吃得到光。水平躺著的路面
 * 入射角幾乎處處相同，同樣的法線貼圖在上面幾乎不產生明暗差。拉高到這裡的
 * 值，壓痕才在俯視圖上讀得出來——**這不是把材質改強，是補償朝向造成的差別**，
 * 貼圖本身仍是全元件共用的同一張。
 */
const FLAT_SURFACE_NORMAL_SCALE = 3.6;

/** 車道虛線：長、寬、間隔，單位是世界單位。 */
const LANE_DASH = { length: 1.1, width: 0.16, gap: 1.0, height: 0.035 } as const;

/**
 * 審查用的路面切片尺寸。
 *
 * 比遊戲的整條賽道小得多是刻意的：`§3` 規定每格 512×512 四視角，把 12 單位
 * 寬、188 單位長的整個環塞進去，壓痕會小到看不見——而 `§5.4` 的一眼判斷
 * （「貼近看，路面是被壓平的一塊黏土還是貼上去的一張材質」）**要求貼近看**。
 * 壓痕的世界尺度兩者完全相同，切片只是取景範圍不同。
 */
const REVIEW = { roadWidth: 5, roadLength: 7, grassMargin: 1.8 } as const;

/**
 * 環形路面，UV 直接用世界尺度算。
 *
 * `RingGeometry` 不能用：它的 UV 是放射狀的 0..1，內圈周長 2π·24 與外圈
 * 2π·36 差 50%，同一張貼圖鋪上去內圈會被擠密、外圈被拉開——正是 `§5.4`
 * 點名的「一拉伸就不像同一套材質」。這裡 u 走真實弧長、v 走真實徑向距離，
 * 除以 `PRESS_REPEAT_WORLD_UNITS`（由 `pressRepeatFor` 換算），
 * 所以環上每一點的壓痕都是同一個世界尺度。
 */
function annulusWithWorldUv(
  innerRadius: number,
  outerRadius: number,
  segments: number,
  y: number,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let j = 0; j <= 1; j++) {
      const radius = j === 0 ? innerRadius : outerRadius;
      positions.push(cos * radius, y, sin * radius);
      normals.push(0, 1, 0);
      // u = 弧長 / 基準，v = 徑向距離 / 基準。兩者都是世界單位。
      uvs.push(
        pressRepeatFor(angle * radius),
        pressRepeatFor(j === 0 ? 0 : outerRadius - innerRadius),
      );
    }
  }

  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

/** 環的側立面——接縫看得到，靠的就是這一圈。 */
function annulusWall(radius: number, segments: number, top: number, bottom: number): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let j = 0; j <= 1; j++) {
      positions.push(cos * radius, j === 0 ? bottom : top, sin * radius);
      normals.push(cos, 0, sin);
      uvs.push(pressRepeatFor(angle * radius), pressRepeatFor(j === 0 ? 0 : top - bottom));
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

/**
 * 遊戲用的整條賽道路面。原點在賽道圓心，呼叫端自行擺到 `TRACK_GEOMETRY`
 * 的中心；路面頂面在 `y = SLAB_HEIGHT`，草地留在 `y ≈ 0`。
 */
export function createTrackSurfaceRing(
  radius: number,
  halfWidth: number,
  segments = 144,
): Group {
  const group = new Group();
  group.name = 'track-surface-ring';

  const inner = radius - halfWidth;
  const outer = radius + halfWidth;
  // UV 已經自帶世界尺度，貼圖本身不再乘倍率。
  const road = createClayMaterial({
    color: TERRAIN.path,
    textureScale: 1,
    normalScale: FLAT_SURFACE_NORMAL_SCALE,
  });
  const sand = createClayMaterial({
    color: TERRAIN.islandSand,
    textureScale: 1,
    normalScale: FLAT_SURFACE_NORMAL_SCALE,
  });

  const surface = new Mesh(annulusWithWorldUv(inner, outer, segments, SLAB_HEIGHT), road);
  surface.receiveShadow = true;
  group.add(surface);

  // 兩側奶油沙邊帶（§5.4「邊緣可退到島緣奶油沙」），略高於路面避免 z-fight。
  for (const [from, to] of [
    [inner, inner + SAND_EDGE_WIDTH],
    [outer - SAND_EDGE_WIDTH, outer],
  ] as const) {
    const band = new Mesh(
      annulusWithWorldUv(from, to, segments, SLAB_HEIGHT + 0.002),
      sand,
    );
    band.receiveShadow = true;
    group.add(band);
  }

  // 接縫立面：路面與草地的交界看得到，是幾何不是顏色。
  for (const edgeRadius of [inner, outer]) {
    const wall = new Mesh(annulusWall(edgeRadius, segments, SLAB_HEIGHT, -0.02), sand);
    wall.receiveShadow = true;
    wall.castShadow = true;
    group.add(wall);
  }

  // 車道虛線：沿中線鋪，數量由周長算，讓間隔在世界尺度上一致。
  const centre = radius;
  const stride = LANE_DASH.length + LANE_DASH.gap;
  const dashCount = Math.max(1, Math.round((Math.PI * 2 * centre) / stride));
  const dashMaterial = createClayMaterial({
    color: TERRAIN.islandSand,
    textureScale: pressRepeatFor(LANE_DASH.length),
  });
  for (let i = 0; i < dashCount; i++) {
    const angle = (i / dashCount) * Math.PI * 2;
    const dash = new Mesh(
      claySlab(LANE_DASH.width, LANE_DASH.height, LANE_DASH.length),
      dashMaterial,
    );
    dash.position.set(
      Math.cos(angle) * centre,
      SLAB_HEIGHT + LANE_DASH.height * 0.5,
      Math.sin(angle) * centre,
    );
    // 讓長邊沿著行進方向（切線），不是指向圓心。
    dash.rotation.y = -angle;
    dash.receiveShadow = true;
    group.add(dash);
  }

  return group;
}

/**
 * `§3` 元件審查用的路面切片：路面 + 兩側奶油沙邊帶 + 草地 + 中線虛線，
 * 交界處有真的高低差。原點在切片中心，路面頂面在 `y = SLAB_HEIGHT`。
 */
export function createTrackSurface(): Group {
  const group = new Group();
  group.name = 'track-surface';

  const totalWidth = REVIEW.roadWidth + REVIEW.grassMargin * 2;
  const length = REVIEW.roadLength;

  // 草地底板。壓痕同樣走世界尺度換算，不是手調常數。
  const grass = new Mesh(
    applyHandPressedRelief(
      // 分段夠密才有頂點可以位移——1×1 的 plane 只有四個角，位移不出東西。
      // 每個波長至少要有 6 段才描得出波形，否則位移會被取樣成折線。
      //
      // **先把 geometry 轉平，不要留給 mesh 轉**：`PlaneGeometry` 建出來是躺在
      // XY 平面的，若等 mesh 再轉，`applyHandPressedRelief` 拿到的區域座標 `z`
      // 恆為 0，噪聲退化成一維波紋——實測草地的明暗變化因此只有 1.18%，比振幅
      // 更小的路面（2.24%）還平。轉平後區域座標與世界一致，噪聲才是二維的。
      new PlaneGeometry(
        totalWidth,
        length,
        Math.round(totalWidth * 16),
        Math.round(length * 16),
      ).rotateX(-Math.PI / 2),
      RELIEF.grass,
    ),
    createClayMaterial({
      color: TERRAIN.grassMid,
      textureScale: pressRepeatFor(totalWidth),
      normalScale: FLAT_SURFACE_NORMAL_SCALE,
    }),
  );
  grass.receiveShadow = true;
  group.add(grass);

  // 路面：**厚度與可見表面分成兩塊**。
  //
  // 原本想用單一 `claySlab`（`RoundedBoxGeometry`）加起伏一次做完，但實測
  // 位移在它上面不生效：把振幅從 0.038 加到 0.25（6.5 倍）、`segments` 從 40
  // 改到 6，成品圖的路面區域 sd 都停在 3.00±0.02，側視輪廓是一條直線，
  // 而同一支 `applyHandPressedRelief` 在草地的 `PlaneGeometry` 上完全正常
  // （sd 從 1.98 變 9.19）。在 node 裡單獨對 `RoundedBoxGeometry` 跑同一段
  // 位移數學，6084 個頂點確實全部移動、y 範圍從 ±0.065 撐到 ±0.095——
  // **數學沒問題，是它在這條算繪路徑上不生效**，原因未查明。
  //
  // 不繼續追是判斷不是放棄：可見表面本來就該是一張夠密的網格，用有厚度的
  // 圓角盒去承載表面細節，等於為了 12 個看不到的側面頂點付整塊的細分成本
  // （`segments: 40` 時是 236,196 個頂點，`BAR-PERF §5.4` 的預算才 400k
  // 三角形）。拆成「一張起伏的表面 + 一塊只負責厚度的板」兩件事更省也更清楚。
  // 異常本身記進 `loop/BACKLOG.md`。
  const roadBody = new Mesh(
    claySlab(REVIEW.roadWidth, SLAB_HEIGHT, length, { bevelRatio: 0.12 }),
    createClayMaterial({
      color: TERRAIN.path,
      textureScale: pressRepeatFor(REVIEW.roadWidth),
      normalScale: FLAT_SURFACE_NORMAL_SCALE,
    }),
  );
  roadBody.position.y = SLAB_HEIGHT * 0.5;
  roadBody.castShadow = true;
  roadBody.receiveShadow = true;
  group.add(roadBody);

  // 可見的路面表面：起伏走跟草地相同的路徑（轉平的 plane），差 1mm 疊在
  // 板子頂面上避免 z-fight。
  const roadTop = new Mesh(
    applyHandPressedRelief(
      new PlaneGeometry(
        REVIEW.roadWidth,
        length,
        Math.round(REVIEW.roadWidth * 16),
        Math.round(length * 16),
      ).rotateX(-Math.PI / 2),
      RELIEF.road,
    ),
    createClayMaterial({
      color: TERRAIN.path,
      textureScale: pressRepeatFor(REVIEW.roadWidth),
      normalScale: FLAT_SURFACE_NORMAL_SCALE,
    }),
  );
  roadTop.position.y = SLAB_HEIGHT + 0.001;
  roadTop.receiveShadow = true;
  group.add(roadTop);

  // 兩側奶油沙邊帶，壓在路面上緣。
  const sandMaterial = createClayMaterial({
    color: TERRAIN.islandSand,
    textureScale: pressRepeatFor(SAND_EDGE_WIDTH),
  });
  for (const side of [-1, 1]) {
    const band = new Mesh(
      claySlab(SAND_EDGE_WIDTH, 0.045, length, { bevelRatio: 0.18 }),
      sandMaterial,
    );
    band.position.set(
      side * (REVIEW.roadWidth * 0.5 - SAND_EDGE_WIDTH * 0.5),
      SLAB_HEIGHT + OVERLAY_LIFT,
      0,
    );
    band.receiveShadow = true;
    group.add(band);
  }

  // 中線虛線。
  const dashMaterial = createClayMaterial({
    color: TERRAIN.islandSand,
    textureScale: pressRepeatFor(LANE_DASH.length),
  });
  const stride = LANE_DASH.length + LANE_DASH.gap;
  const dashCount = Math.max(1, Math.floor(length / stride));
  const firstZ = -((dashCount - 1) * stride) * 0.5;
  for (let i = 0; i < dashCount; i++) {
    const dash = new Mesh(
      claySlab(LANE_DASH.width, LANE_DASH.height, LANE_DASH.length),
      dashMaterial,
    );
    dash.position.set(0, SLAB_HEIGHT + OVERLAY_LIFT + LANE_DASH.height * 0.5, firstZ + i * stride);
    dash.receiveShadow = true;
    group.add(dash);
  }

  return group;
}
