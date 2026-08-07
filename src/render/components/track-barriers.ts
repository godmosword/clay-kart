/**
 * `BAR-VISUAL §4` 元件 #5：`track-barriers`——護欄、路緣石。
 *
 * `§5.5` 四條的逐條對應：
 *
 * - **材質**「護欄是**一段一段捏出來再接起來**，不是一根無限長的擠出管。
 *   每段之間留縫，段與段的長度略有出入 —— 完全等長會讀成塑膠射出件」
 *   → 這是本元件的全部重點。遊戲在 R28 之前是一圈 `TorusGeometry` 圓管，
 *   那正是條文點名要排除的「無限長的擠出管」。現在是離散段體，段間留縫，
 *   長度取三個變體輪流而不是等長
 * - **色**「品牌橘 `#ff8c2b` 與奶油白 `#f0e4cd` 交替」→ `CAR_PARK.brandOrange`
 *   與 `XIAOHONG.cream`，兩色交替
 * - **比例**「高度約半個輪徑」→ `WHEEL_ROLLING_RADIUS` 是 0.355，
 *   輪徑 0.71，半個是 0.355。矮到不擋視線，高到看得出是邊界
 * - **一眼判斷**「看得出來『一段一段接起來』嗎?」→ 段間的縫在四個視角都看得到
 *
 * ## 為什麼用 InstancedMesh
 *
 * 賽道周長 `2π × 30 ≈ 188` 單位，內外兩圈。段長約 1.2 加上縫，一圈約 140 段，
 * 兩圈 280 段。**每個 `Mesh` 一次 draw call，而 `BAR-PERF §5.3` 的預算是 150**
 * ——直接擺 280 個 Mesh 會直接撞穿。
 *
 * `InstancedMesh` 讓同一個 geometry + material 的所有段合成一次 draw call。
 * 長度變體用**三個不同的 geometry** 而不是縮放單一 geometry：非等比縮放會把
 * 倒角一起拉長，違反 `§5.0` 的「所有邊角圓潤帶微倒角，**半徑一致**」。
 * 三個長度 × 兩個顏色 = 6 次 draw call，遠在預算內。
 *
 * 這也是 `track-surface` 的離散細節（草叢、石子）還沒接進遊戲環的原因——
 * 那些同樣需要這套處理，之後應該共用同一個做法。
 */
import { Group, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { claySlab } from '../clay/geometry.js';
import { createClayMaterial, pressRepeatFor } from '../clay/material.js';
import { CAR_PARK, TERRAIN, XIAOHONG } from '../clay/palette.js';
import { WHEEL_ROLLING_RADIUS } from './kart-wheels.js';

/** `§5.5` 比例條款：高度約半個輪徑。輪徑 = 滾動半徑 × 2。 */
const BARRIER_HEIGHT = WHEEL_ROLLING_RADIUS;

/** 護欄厚度。夠厚才像捏出來的塊，不像立起來的板。 */
const BARRIER_DEPTH = 0.3;

/**
 * 三個長度變體。**刻意不等長**——`§5.5` 明文「段與段的長度略有出入，
 * 完全等長會讀成塑膠射出件」。用三個獨立 geometry 而不是縮放同一個：
 * 非等比縮放會把倒角一起拉長，違反 `§5.0` 的「倒角半徑一致」。
 */
const SEGMENT_LENGTHS = [1.05, 1.28, 1.46] as const;

/** 段與段之間的縫。`§5.5` 的「每段之間留縫」。 */
const SEGMENT_GAP = 0.13;

/** 兩色交替（`§5.5` 色條款）。 */
const SEGMENT_COLORS = [CAR_PARK.brandOrange, XIAOHONG.cream] as const;

interface SegmentPlacement {
  /** 段中心的世界座標。 */
  position: Vector3;
  /** 繞 Y 的朝向，讓長邊沿著護欄走向。 */
  yaw: number;
  /** 用哪一個長度變體。 */
  lengthIndex: number;
  /** 用哪一個顏色。 */
  colorIndex: number;
}

function segmentGeometries(): BufferGeometry[] {
  return SEGMENT_LENGTHS.map((length) =>
    // 倒角走 claySlab 的預設手捏比例——三個變體的最短邊都是厚度 0.3，
    // 所以倒角半徑自然一致，不需要另外對齊。
    claySlab(BARRIER_DEPTH, BARRIER_HEIGHT, length),
  );
}

/**
 * 把一組擺放位置化成 InstancedMesh 加進 group。
 * 同一個 (長度, 顏色) 組合共用一次 draw call。
 */
function addInstanced(group: Group, placements: SegmentPlacement[]): void {
  const geometries = segmentGeometries();
  const materials = SEGMENT_COLORS.map((color) =>
    createClayMaterial({
      color,
      // 護欄是小件，壓痕要比路面密一階才看得到；仍走世界尺度換算，
      // 不是手調常數（`§5.4` 的比例條款對所有元件都適用）。
      textureScale: pressRepeatFor(BARRIER_HEIGHT * 2),
    }),
  );

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const axis = new Vector3(0, 1, 0);

  for (let li = 0; li < geometries.length; li++) {
    for (let ci = 0; ci < materials.length; ci++) {
      const bucket = placements.filter((p) => p.lengthIndex === li && p.colorIndex === ci);
      if (bucket.length === 0) continue;
      const mesh = new InstancedMesh(geometries[li]!, materials[ci]!, bucket.length);
      bucket.forEach((placement, i) => {
        quaternion.setFromAxisAngle(axis, placement.yaw);
        matrix.compose(placement.position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

/**
 * 沿一個圓周鋪護欄段。回傳擺放清單，讓內外圈可以合併成同一批 instance。
 *
 * 長度變體與顏色都用**位置決定的序列**而不是亂數：元件審查圖必須可以重複產生
 * （跟 `applyHandPressedRelief` 的 value noise 同一個原則）。
 */
function ringPlacements(radius: number, startIndex: number): SegmentPlacement[] {
  const out: SegmentPlacement[] = [];
  const circumference = Math.PI * 2 * radius;
  // 先用平均段長估數量，再讓實際段長吃掉誤差——縫本來就允許不等寬。
  const averageStride =
    SEGMENT_LENGTHS.reduce((a, b) => a + b, 0) / SEGMENT_LENGTHS.length + SEGMENT_GAP;
  const count = Math.max(3, Math.round(circumference / averageStride));

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const n = startIndex + i;
    out.push({
      position: new Vector3(
        Math.cos(angle) * radius,
        BARRIER_HEIGHT * 0.5,
        Math.sin(angle) * radius,
      ),
      // 長邊沿切線走，不是指向圓心。
      yaw: -angle,
      // 三個長度輪流，但用 3 與 2 互質的步進讓長度與顏色不同步——
      // 同步的話會變成「橘長白短」的規律花紋，那又是另一種等長。
      lengthIndex: n % SEGMENT_LENGTHS.length,
      colorIndex: n % SEGMENT_COLORS.length,
    });
  }
  return out;
}

/**
 * 遊戲用的內外兩圈護欄。原點在賽道圓心，呼叫端擺到 `TRACK_GEOMETRY` 的中心。
 *
 * 內外圈的 instance 合併成同一批——同一個 (長度, 顏色) 組合只有一次 draw call，
 * 不因為分兩圈而變兩次。
 */
export function createTrackBarrierRings(radius: number, halfWidth: number): Group {
  const group = new Group();
  group.name = 'track-barriers-rings';

  const inner = ringPlacements(radius - halfWidth, 0);
  // 外圈的 startIndex 錯開，內外兩圈的顏色不會在同一個角度對齊
  const outer = ringPlacements(radius + halfWidth, 1);
  addInstanced(group, [...inner, ...outer]);

  return group;
}

/**
 * `§3` 元件審查用的直線切片：六段護欄擺在一小塊地上。
 *
 * 直線而不是弧線是刻意的——`§5.5` 的一眼判斷是「看得出來一段一段接起來嗎」，
 * 直線讓段與段的縫在四個視角都最清楚。弧線會讓遠端的縫因為透視擠在一起。
 */
export function createTrackBarrier(): Group {
  const group = new Group();
  group.name = 'track-barriers';

  const placements: SegmentPlacement[] = [];
  let z = 0;
  for (let i = 0; i < 6; i++) {
    const length = SEGMENT_LENGTHS[i % SEGMENT_LENGTHS.length]!;
    z += length * 0.5;
    placements.push({
      position: new Vector3(0, BARRIER_HEIGHT * 0.5, z),
      yaw: 0,
      lengthIndex: i % SEGMENT_LENGTHS.length,
      colorIndex: i % SEGMENT_COLORS.length,
    });
    z += length * 0.5 + SEGMENT_GAP;
  }
  // 置中，讓 `§3` 的四視角框得住
  const totalLength = z - SEGMENT_GAP;
  for (const p of placements) p.position.z -= totalLength * 0.5;

  addInstanced(group, placements);

  // 一小塊地，讓護欄不是浮在空中——`§5.0` 的接地陰影要有東西可以落。
  //
  // **刻意做窄。** 第一版寬度取 `totalLength * 0.55`（約 4.6 單位），底板佔掉
  // 大半個畫面，護欄變成一條細線——而 `§5.5` 的一眼判斷是「看得出來一段一段
  // 接起來嗎」，主體必須是護欄。`§7.1` 判準 2 對參考半邊要求「元件主體佔畫面
  // 主要面積」，我們自己這半邊沒有理由不遵守同一條。
  const groundWidth = BARRIER_DEPTH * 5;
  const ground = new Mesh(
    new PlaneGeometry(groundWidth, totalLength).rotateX(-Math.PI / 2),
    createClayMaterial({
      color: TERRAIN.path,
      textureScale: pressRepeatFor(totalLength),
    }),
  );
  ground.receiveShadow = true;
  group.add(ground);

  return group;
}
