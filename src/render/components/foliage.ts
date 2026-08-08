/**
 * `BAR-VISUAL §4` 元件 #6：`foliage`——樹木、草叢。
 *
 * ## 這個元件推翻了 `§5.6` 的一句話
 *
 * `§5.6` 的材質條款原本寫著：「樹冠是**團塊堆疊**（黃金樣本的樹就是幾顆球
 * 疊起來）」，一眼判斷是「樹冠看得出來是幾顆黏土球捏在一起嗎?」。
 *
 * 實際去看黃金樣本 `refs/clay/car-park.png` 的兩棵樹（放大 7–8 倍檢視）：
 * **樹冠是一顆圓穹，表面壓滿一片片交疊的葉瓣**，不是幾顆球疊起來。兩棵都
 * 一樣。條文括號裡對黃金樣本的描述是錯的。
 *
 * 這跟 R28 的 `§5.5` vs `§6` 是同一個形狀——規範自己說錯了，而
 * `palette.ts` 的檔頭寫明「黃金樣本為唯一真相」。依那句話，黃金樣本勝，
 * `§5.6` 已改（見 `BAR-VISUAL.md` 的修訂記錄）。
 *
 * 所以這裡做的是：**一顆圓穹 + 一片片壓上去的葉瓣**。
 *
 * ## `§5.6`（修訂後）逐條對應
 *
 * - **材質**「樹冠是一顆團塊，表面壓滿一片片交疊的葉瓣」→ `crownDome()` 是
 *   單一球體，`leafPadPlacements()` 在它表面鋪 `LEAF_PADS_PER_TREE` 片扁平
 *   葉瓣。葉瓣半埋進圓穹，交界處露出底下較深的綠——那就是 `§5.0` 要的接縫
 * - **材質**「草叢是短短的一撮一撮，不是連續草皮」→ `tuftPlacements()`
 *   離散擺放，不是一張草皮貼圖
 * - **色**「草地三階都要用上」→ 圓穹 `grassDark`、葉瓣 `grassMid` 與
 *   `grassLight` 混用、草叢 `grassLight` 與 `grassDark`。取自黃金樣本的實測：
 *   樹冠中間調 `#85ae4f`／`#8bb65b` 幾乎正好是 `grassDark`，亮部接近
 *   `grassMid`——既有 token 本來就對得上，不需要新增綠色
 * - **比例**「樹高約 1.5 個車長」→ 車長 2.4（`BAR-FEEL §1.1`），
 *   `TREE_HEIGHT` = 3.58 = 1.49 個車長
 * - **比例**「樹冠誇張的圓，樹幹短粗」→ 樹冠直徑 2.32 是樹高的 0.65；
 *   樹幹高 1.05（樹高的 0.29）而底半徑 0.30，高徑比 3.5:1
 *
 * ## draw call 預算
 *
 * `BAR-PERF §5.3` 的上限是 150，R28 之後遊戲在 137——**只剩 13**。
 * 所以每一樣東西都必須是 `InstancedMesh`：
 *
 *     圓穹 1 + 葉瓣 2（兩個綠）+ 樹幹 1 + 草叢 2（兩個綠）= 6
 *
 * `InstancedMesh` 的 instance 數不影響 draw call，但**會影響三角形數**，而
 * 那有另一個預算（400k，R28 在 74k）。葉瓣是大宗：每棵樹
 * `LEAF_PADS_PER_TREE` 片，乘上樹的數量。兩個數字都在 `renderer.ts` 接線
 * 之後實測過，不是估的。
 */
import {
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { BufferGeometry, Material } from 'three';
import { applyHandPressedRelief, clayBlob } from '../clay/geometry.js';
import { createClayMaterial, pressRepeatFor } from '../clay/material.js';
import { placementHash } from '../clay/placement.js';
import { TERRAIN } from '../clay/palette.js';

/** `BAR-FEEL §1.1` 的車長，`§5.6` 的比例基準。 */
const CAR_LENGTH = 2.4;

const TRUNK_HEIGHT = 1.05;
/** 底比頂粗——黃金樣本的樹幹是往下微張的，不是等徑圓柱。 */
const TRUNK_RADIUS_BASE = 0.36;
const TRUNK_RADIUS_TOP = 0.28;

const CROWN_CENTER_Y = 2.3;
const CROWN_RADIUS = 1.28;

/** `§5.6`「樹高約 1.5 個車長」。實際 3.58 / 2.4 = 1.49。 */
const TREE_HEIGHT = CROWN_CENTER_Y + CROWN_RADIUS;

/**
 * 每棵樹的葉瓣數。
 *
 * 這個數字直接乘上樹的數量進三角形預算，所以不能隨手加大。26 是「近看數得
 * 出一片一片、遠看連成一片綠」的下限附近——再少圓穹底色會透出來變成斑點。
 */
const LEAF_PADS_PER_TREE = 30;

/**
 * 葉瓣半徑。**量自黃金樹**：樹冠直徑約 55px、單片葉瓣約 11px，
 * 也就是葉瓣半徑約樹冠半徑的 0.40。
 *
 * 第一版取 0.29（樹冠半徑的 0.25），配 26 片的覆蓋率只有 52%——深色圓穹
 * 因此變成**底**而不是**縫**，整顆樹讀成「圓球上的淺綠斑點」。覆蓋率要超過
 * 1 才會翻轉成「葉瓣交疊、縫裡透出深色」。
 *
 * 現值 0.46 配 30 片：30 × π×0.46² / (0.78 × 4π×1.28²) ≈ 1.2 倍覆蓋。
 */
const LEAF_PAD_RADIUS = 0.46;

/**
 * 葉瓣往圓穹裡埋多深（佔葉瓣厚度的比例）。
 *
 * 半埋是重點：完全貼在表面會讀成貼上去的鱗片，埋一半才像「壓進去的」。
 */
const LEAF_PAD_SINK = 0.4;

interface Placement {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  /** 用哪一個顏色桶。 */
  colorIndex: number;
}

function placement(
  position: Vector3,
  quaternion: Quaternion,
  scale: Vector3,
  colorIndex: number,
): Placement {
  return { position, quaternion, scale, colorIndex };
}

/**
 * 把一批擺放合成 `InstancedMesh`，同一個顏色桶一次 draw call。
 *
 * `geometry` 與 `materials` 由呼叫端建好傳進來——這支只負責合批，
 * 不決定長相。
 */
function addInstanced(
  group: Group,
  geometry: BufferGeometry,
  materials: readonly Material[],
  placements: readonly Placement[],
): void {
  const matrix = new Matrix4();
  for (let ci = 0; ci < materials.length; ci++) {
    const bucket = placements.filter((p) => p.colorIndex === ci);
    if (bucket.length === 0) continue;
    const mesh = new InstancedMesh(geometry, materials[ci]!, bucket.length);
    bucket.forEach((p, i) => {
      matrix.compose(p.position, p.quaternion, p.scale);
      mesh.setMatrixAt(i, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/**
 * 圓穹上的葉瓣位置，用黃金角螺旋（Fibonacci sphere）鋪。
 *
 * **為什麼不是亂數**：跟 `placementHash` 同一個理由——元件審查圖必須可以重複
 * 產生。而黃金角螺旋比亂數更好：它保證間距均勻，不會出現亂數難免的「一塊擠
 * 一塊空」，那種空隙會露出底下的深綠讀成破洞。
 *
 * 不規則性靠每片各自的旋轉與大小抖動加回去，不靠位置亂跳。
 */
function leafPadPlacements(
  treeIndex: number,
  origin: Vector3,
  treeScale: number,
): Placement[] {
  const out: Placement[] = [];
  const up = new Vector3(0, 1, 0);
  const golden = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < LEAF_PADS_PER_TREE; i++) {
    // 只鋪上方 78%：圓穹底面朝下，那裡的葉瓣看不到但一樣要付三角形。
    const t = (i + 0.5) / LEAF_PADS_PER_TREE;
    const y = 1 - t * 1.56;
    const ringRadius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const normal = new Vector3(
      Math.cos(theta) * ringRadius,
      y,
      Math.sin(theta) * ringRadius,
    ).normalize();

    const salt = treeIndex * 37 + i;
    // 葉瓣中心落在圓穹表面往內 sink 一點，讓它半埋。
    const depth = CROWN_RADIUS - LEAF_PAD_RADIUS * LEAF_PAD_SINK;
    const position = normal.clone().multiplyScalar(depth * treeScale).add(origin);

    // 讓葉瓣的扁軸對齊法線——扁的那一面貼著圓穹。
    const quaternion = new Quaternion().setFromUnitVectors(up, normal);
    // 再繞法線自轉，同一片幾何不會在整棵樹上重複同一個朝向。
    quaternion.multiply(
      new Quaternion().setFromAxisAngle(up, placementHash(salt, 1) * Math.PI * 2),
    );

    const wobble = 0.82 + placementHash(salt, 2) * 0.36;
    out.push(
      placement(
        position,
        quaternion,
        // 扁：沿法線壓到 0.5，橫向兩軸各自不等，避免每片都是正圓。
        new Vector3(
          wobble * treeScale,
          wobble * 0.62 * treeScale,
          wobble * (0.88 + placementHash(salt, 3) * 0.28) * treeScale,
        ),
        placementHash(salt, 4) > 0.86 ? 1 : 0,
      ),
    );
  }
  return out;
}

/** 一棵樹的圓穹、樹幹、葉瓣擺放。`treeIndex` 決定所有抖動。 */
interface TreeParts {
  dome: Placement;
  trunk: Placement;
  pads: Placement[];
}

function treePlacements(treeIndex: number, base: Vector3): TreeParts {
  // 每棵樹整體大小抖動。等大的一排樹跟等長的護欄是同一個問題（`§5.5`）。
  const treeScale = 0.82 + placementHash(treeIndex, 21) * 0.42;
  const yaw = placementHash(treeIndex, 22) * Math.PI * 2;
  const spin = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);

  const crownCenter = new Vector3(
    base.x,
    base.y + CROWN_CENTER_Y * treeScale,
    base.z,
  );

  return {
    dome: placement(
      crownCenter,
      spin.clone(),
      // 略高於寬——黃金樣本的樹冠不是正球，上緣比較挺。
      new Vector3(treeScale, treeScale * 1.05, treeScale),
      0,
    ),
    trunk: placement(
      new Vector3(base.x, base.y + TRUNK_HEIGHT * 0.5 * treeScale, base.z),
      spin.clone(),
      new Vector3(treeScale, treeScale, treeScale),
      0,
    ),
    pads: leafPadPlacements(treeIndex, crownCenter, treeScale),
  };
}

/** 圓穹幾何。起伏讓輪廓不是數學球，葉瓣的縫因此深淺不一。 */
function crownGeometry(): BufferGeometry {
  return applyHandPressedRelief(clayBlob(CROWN_RADIUS, 16), {
    amplitude: 0.06,
    wavelength: 0.9,
  });
}

function trunkGeometry(): BufferGeometry {
  // 上下緣是銳的，但頂面埋在樹冠裡、底面埋在地裡，兩個都看不到。
  // `§5.0` 的「所有邊角圓潤」講的是看得到的邊。
  const geometry = new CylinderGeometry(
    TRUNK_RADIUS_TOP,
    TRUNK_RADIUS_BASE,
    TRUNK_HEIGHT,
    12,
    3,
  );
  // 圓柱上的起伏會沿著垂直方向連成一條條——那正好是樹皮該有的樣子。
  return applyHandPressedRelief(geometry, { amplitude: 0.022, wavelength: 0.45 });
}

function leafPadGeometry(): BufferGeometry {
  // 低面數：這是全場 instance 數最多的東西，每多一段就乘上葉瓣總數。
  return clayBlob(LEAF_PAD_RADIUS, 6);
}

function tuftGeometry(): BufferGeometry {
  return clayBlob(0.17, 6);
}

interface FoliageMaterials {
  dome: Material;
  trunk: Material;
  pads: readonly Material[];
  tufts: readonly Material[];
}

function foliageMaterials(): FoliageMaterials {
  return {
    // 圓穹是縫裡露出來的底色，取三階裡最深的。
    dome: createClayMaterial({
      color: TERRAIN.grassDark,
      textureScale: pressRepeatFor(CROWN_RADIUS * 2),
    }),
    trunk: createClayMaterial({
      color: TERRAIN.bark,
      textureScale: pressRepeatFor(TRUNK_HEIGHT),
    }),
    // 葉瓣以中階為主、亮階**只點綴 14%**。第一版亮階佔 28%，配上當時偏小的
    // 葉瓣，整顆樹讀成波卡圓點——淺綠與深綠的對比變成了圖案，而不是同一塊
    // 黏土上的受光差。黃金樣本的葉瓣與圓穹幾乎同色，深的地方是**縫的陰影**
    // 不是另一個顏色。`§5.6` 的三階仍然全部用上（亮階在這裡與草叢）。
    pads: [TERRAIN.grassMid, TERRAIN.grassLight].map((color) =>
      createClayMaterial({ color, textureScale: pressRepeatFor(LEAF_PAD_RADIUS * 2) }),
    ),
    tufts: [TERRAIN.grassLight, TERRAIN.grassDark].map((color) =>
      createClayMaterial({ color, textureScale: pressRepeatFor(0.34) }),
    ),
  };
}

/** 一撮草。`§5.6`「短短的一撮一撮，不是連續草皮」。 */
function tuftPlacement(index: number, base: Vector3): Placement {
  const scale = 0.7 + placementHash(index, 31) * 0.75;
  return placement(
    new Vector3(base.x, base.y + 0.02, base.z),
    new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      placementHash(index, 32) * Math.PI * 2,
    ),
    // 矮而寬——「短短的一撮」，立起來就變成灌木了。但**不能太扁**：第一版
    // 壓到 0.45–0.85，算繪出來是地上的淺色斑點而不是立體的一撮，因為太扁的
    // 半球在頂光下幾乎沒有明暗變化，剩下的只有色差。黃金樣本的草叢是圓鼓的
    // 小丘，看得到自己的暗面。
    new Vector3(
      scale * (0.8 + placementHash(index, 33) * 0.5),
      scale * (0.72 + placementHash(index, 34) * 0.45),
      scale * (0.8 + placementHash(index, 35) * 0.5),
    ),
    // 以**深階為主**、亮階點綴。反過來（亮階為主）就是斑點的來源：
    // 地面是中階，亮階草叢在上面是往亮的方向跳，深階才讀成「上面長了東西」。
    placementHash(index, 36) > 0.7 ? 0 : 1,
  );
}

function buildFoliage(
  group: Group,
  treeBases: readonly Vector3[],
  tuftBases: readonly Vector3[],
): void {
  const materials = foliageMaterials();

  const domes: Placement[] = [];
  const trunks: Placement[] = [];
  const pads: Placement[] = [];
  treeBases.forEach((base, i) => {
    const parts = treePlacements(i, base);
    domes.push(parts.dome);
    trunks.push(parts.trunk);
    pads.push(...parts.pads);
  });

  addInstanced(group, crownGeometry(), [materials.dome], domes);
  addInstanced(group, trunkGeometry(), [materials.trunk], trunks);
  addInstanced(group, leafPadGeometry(), materials.pads, pads);
  addInstanced(
    group,
    tuftGeometry(),
    materials.tufts,
    tuftBases.map((base, i) => tuftPlacement(i, base)),
  );
}

/** 賽道內外的樹與草叢。原點在賽道圓心，呼叫端擺到 `TRACK_GEOMETRY` 的中心。 */
export function createFoliageScatter(
  radius: number,
  halfWidth: number,
  options: { outerTrees?: number; innerTrees?: number; tufts?: number } = {},
): Group {
  const group = new Group();
  group.name = 'foliage-scatter';

  const outerTrees = options.outerTrees ?? 34;
  const innerTrees = options.innerTrees ?? 14;
  const tufts = options.tufts ?? 420;

  // 樹離護欄留距離：`§5.6` 沒說，但樹貼著護欄長會擋住賽道視線，而
  // `BAR-FEEL` 的轉向手感是靠看得到彎道建立的。
  const outerStart = radius + halfWidth + 3.2;
  const innerEnd = radius - halfWidth - 3.2;

  const treeBases: Vector3[] = [];
  for (let i = 0; i < outerTrees; i++) {
    const angle = (i / outerTrees) * Math.PI * 2 + placementHash(i, 41) * 0.16;
    const r = outerStart + placementHash(i, 42) * 15;
    treeBases.push(new Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
  }
  for (let i = 0; i < innerTrees; i++) {
    const salt = 1000 + i;
    const angle = (i / innerTrees) * Math.PI * 2 + placementHash(salt, 41) * 0.3;
    const r = 4 + placementHash(salt, 42) * (innerEnd - 4);
    treeBases.push(new Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
  }

  // 草叢鋪在賽道以外的地面。落在路面上的直接丟掉——半徑抽樣本來就會撒進去。
  const tuftBases: Vector3[] = [];
  for (let i = 0; tuftBases.length < tufts && i < tufts * 3; i++) {
    const angle = placementHash(i, 51) * Math.PI * 2;
    const r = 3 + placementHash(i, 52) * 52;
    if (Math.abs(r - radius) < halfWidth + 0.6) continue;
    tuftBases.push(new Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
  }

  buildFoliage(group, treeBases, tuftBases);
  return group;
}

/**
 * `§3` 元件審查用的切片：一棵樹加幾撮草。
 *
 * **只放一棵樹。** `§7.1` 判準 2 要求「元件主體佔畫面主要面積」，那條是寫給
 * 參考半邊的，但我們自己這半邊沒有理由不遵守——`track-barriers` 的底板第一版
 * 做太寬，護欄變成一條細線，是同一個錯。一眼判斷問的是「樹冠表面看得出來是
 * 一片一片壓上去的葉瓣嗎」，那只有在樹夠大的時候答得出來。
 */
export function createFoliage(): Group {
  const group = new Group();
  group.name = 'foliage';

  const tuftBases = [
    new Vector3(-0.95, 0, 0.75),
    new Vector3(0.88, 0, 0.52),
    new Vector3(0.35, 0, -1.02),
    new Vector3(-0.62, 0, -0.78),
    new Vector3(1.12, 0, -0.35),
  ];
  buildFoliage(group, [new Vector3(0, 0, 0)], tuftBases);

  // 一小塊地，讓樹不是浮在空中——`§5.0` 的接地陰影要有東西可以落。
  // 寬度取樹冠直徑的 1.35 倍：夠讓陰影落得下，又不會讓地面搶走畫面。
  const groundSize = CROWN_RADIUS * 2 * 1.35;
  const ground = new Mesh(
    new PlaneGeometry(groundSize, groundSize).rotateX(-Math.PI / 2),
    createClayMaterial({
      color: TERRAIN.grassMid,
      textureScale: pressRepeatFor(groundSize),
    }),
  );
  ground.receiveShadow = true;
  group.add(ground);

  return group;
}

/** 給測試與文件用：這個元件宣稱的比例，可以拿去對 `§5.6` 逐條核。 */
export const FOLIAGE_PROPORTIONS = Object.freeze({
  treeHeight: TREE_HEIGHT,
  treeHeightInCarLengths: TREE_HEIGHT / CAR_LENGTH,
  crownDiameter: CROWN_RADIUS * 2,
  crownDiameterOverHeight: (CROWN_RADIUS * 2) / TREE_HEIGHT,
  trunkHeight: TRUNK_HEIGHT,
  trunkHeightOverTreeHeight: TRUNK_HEIGHT / TREE_HEIGHT,
  trunkSlenderness: TRUNK_HEIGHT / (TRUNK_RADIUS_BASE * 2),
  leafPadsPerTree: LEAF_PADS_PER_TREE,
});
