/**
 * `BAR-VISUAL §4` 元件 #1：`kart-body`——小紅賽車車身。
 *
 * 造型依據 `refs/clay/characters/小紅賽車.jpg`：短軸距、渾圓厚實的甲蟲
 * 車身、圓鼓的前後保險桿、陡起的前擋、短拱車頂、後方高置尾翼。
 *
 * **不含輪子（元件 #2）與臉（元件 #3）**，雖然參考圖上三者在同一台車上。
 *
 * 主量體是**單一側面輪廓擠出**（`clay/profile.ts`），不是堆疊圓角塊——
 * R18 第一版用堆疊法，成品讀起來是「一堆圓角基元」，甲蟲輪廓完全出不來。
 * 附加件（側裙、擋泥板、尾翼、貼片）才用塊體與團塊，它們與主量體的交界
 * 正好給出 `§5.0` 要的「接縫：不同塊黏土接合處留可見縫隙」。
 *
 * 座標系沿用專案慣例：forward = `+Z`、up = `+Y`，原點在**車體正下方的
 * 地面**。尺寸對齊 `src/physics/constants.ts` 的 `CAR_LENGTH=2.4`／
 * `CAR_WIDTH=1.4` 碰撞盒，視覺不超出物理輪廓。
 */
import { Box3, Group, Mesh, ExtrudeGeometry } from 'three';
import { claySlab, clayBlob } from '../clay/geometry.js';
import { extrudeProfile, numeralTwoProfile, xiaohongBodyProfile } from '../clay/profile.js';
import { createClayMaterial } from '../clay/material.js';
import { XIAOHONG } from '../clay/palette.js';

/** 輪心位置，擋泥板依此對齊（輪子本身是元件 #2）。 */
const AXLE_FRONT_Z = 0.72;
const AXLE_REAR_Z = -0.70;
const AXLE_Y = 0.36;

/**
 * 車身寬度。主量體略窄於 `CAR_WIDTH=1.4` 碰撞盒，擋泥板才有外鼓的空間。
 *
 * 1.18 的正視圖看起來偏瘦長；參考圖的車寬長比更接近 0.55，所以放寬一階。
 */
const BODY_WIDTH = 1.26;
const HALF_WIDTH = BODY_WIDTH / 2;

/**
 * 側面貼片的擺放面。
 *
 * 貼片要**貼在殼外**、微微凸出，像參考圖那樣是壓上去的獨立黏土片；
 * 放在半寬以內會被殼吃掉，剛好等於半寬則會 z-fighting。
 */
const DECAL_X = HALF_WIDTH + 0.005;

export function createKartBody(): Group {
  const body = new Group();
  body.name = 'kart-body';

  const red = createClayMaterial({ color: XIAOHONG.body, textureScale: 0.85 });
  const blue = createClayMaterial({ color: XIAOHONG.skirt, textureScale: 1.1 });
  const cream = createClayMaterial({ color: XIAOHONG.cream, textureScale: 2.2 });
  const numberBlue = createClayMaterial({ color: XIAOHONG.numberBlue, textureScale: 3.4 });
  const glass = createClayMaterial({
    color: XIAOHONG.glass,
    // 黏土世界沒有玻璃：車窗是一片淺藍黏土，只是稍微光滑一點。
    roughness: 0.74,
    textureScale: 2,
  });
  const headlight = createClayMaterial({ color: XIAOHONG.headlight, textureScale: 3 });
  const spoilerClay = createClayMaterial({ color: XIAOHONG.spoiler, textureScale: 1.6 });

  // ── 主量體：側面輪廓擠出 ────────────────────────────────────────────
  const hull = new Mesh(
    extrudeProfile(xiaohongBodyProfile(), { width: BODY_WIDTH }),
    red,
  );
  body.add(hull);

  // `ExtrudeGeometry` 的 `bevelSize` 會把輪廓**往外撐**，成品比輪廓座標大
  // 一圈。第一版直接照輪廓數字擺頭燈，結果整顆埋在殼裡——所以改成從實際
  // 包圍盒取表面位置，而不是相信輪廓座標。
  hull.geometry.computeBoundingBox();
  const hullBox = hull.geometry.boundingBox;
  const noseZ = hullBox ? hullBox.max.z : 1.18;

  // ── 側裙 ────────────────────────────────────────────────────────────
  // 比車身略寬，是車體的視覺基座，也遮住主量體的底緣。
  addSlab(body, blue, [1.36, 0.17, 2.0], [0, 0.13, -0.02]);

  // ── 擋泥板 ──────────────────────────────────────────────────────────
  // 只鼓出車身側面一點點，不是掛四顆球——第一版半徑 0.36 的球讓側視圖
  // 看起來像一堆氣球。輪子本身是元件 #2。
  for (const z of [AXLE_FRONT_Z, AXLE_REAR_Z]) {
    for (const side of [1, -1]) {
      const fender = new Mesh(clayBlob(0.3, 18), red);
      fender.position.set(side * (HALF_WIDTH - 0.02), AXLE_Y + 0.06, z);
      fender.scale.set(0.55, 0.72, 1.02);
      body.add(fender);
    }
  }

  // ── 車窗（淺藍黏土片，不是透明玻璃）─────────────────────────────────
  // 前擋：貼在輪廓的前擋斜面上。斜面由 `(0.56, 0.70)` 升到 `(0.30, 1.00)`，
  // 與垂直方向夾角約 41°，所以面板要跟著轉；擺放點再沿法線推出去一點，
  // 才是「壓在殼上」而不是「埋進殼裡」。
  addSlab(body, glass, [0.8, 0.36, 0.07], [0, 0.87, 0.45], [0.714, 0, 0]);
  // 側窗，左右各一。
  for (const side of [1, -1]) {
    addSlab(body, glass, [0.07, 0.26, 0.58], [side * DECAL_X, 0.95, -0.1]);
  }
  // 後窗：後方斜面較緩，角度反向。
  addSlab(body, glass, [0.68, 0.28, 0.07], [0, 0.94, -0.46], [-0.7, 0, 0]);

  // ── 頭燈 ────────────────────────────────────────────────────────────
  // 貼在實際鼻頭表面上，微微凸出。
  for (const side of [1, -1]) {
    const lamp = new Mesh(clayBlob(0.13, 16), headlight);
    lamp.position.set(side * 0.34, 0.5, noseZ - 0.05);
    lamp.scale.set(1, 1, 0.6);
    body.add(lamp);
  }

  // ── 引擎蓋賽車條紋 ──────────────────────────────────────────────────
  // 兩條奶油色黏土條，微微凸出表面（參考圖上是貼上去的，不是畫上去的）。
  // 引擎蓋由 `(0.56, 0.70)` 降到 `(1.02, 0.62)`，往前是**下坡**，所以
  // 繞 X 的旋轉要正值把前端壓低——第一版給負值，條紋往上翹又埋進殼裡。
  for (const side of [1, -1]) {
    addSlab(
      body,
      cream,
      [0.12, 0.04, 0.6],
      [side * 0.14, 0.695, 0.78],
      [0.17, 0, 0],
    );
  }

  // ── 側面號碼圓牌 ────────────────────────────────────────────────────
  for (const side of [1, -1]) {
    const roundel = new Mesh(clayBlob(0.23, 20), cream);
    roundel.position.set(side * DECAL_X, 0.58, -0.28);
    roundel.scale.set(0.1, 1, 1);
    body.add(roundel);

    const numeral = new Mesh(
      new ExtrudeGeometry(numeralTwoProfile(), {
        depth: 0.03,
        bevelEnabled: true,
        bevelThickness: 0.012,
        bevelSize: 0.012,
        bevelSegments: 2,
        curveSegments: 8,
      }),
      numberBlue,
    );
    // 擠出件預設面向 +Z，轉成面向車側。
    numeral.rotation.y = side * Math.PI * 0.5;
    numeral.position.set(side * (DECAL_X + 0.022), 0.58, -0.28);
    body.add(numeral);
  }

  // ── 尾翼 ────────────────────────────────────────────────────────────
  // 兩根短支柱撐一片翼板，貼著尾部——第一版離車身太遠，看起來像飄在
  // 後面的小桌子。
  for (const side of [1, -1]) {
    addSlab(body, spoilerClay, [0.1, 0.22, 0.09], [side * 0.34, 0.86, -0.92]);
  }
  addSlab(body, spoilerClay, [0.98, 0.08, 0.26], [0, 0.99, -0.94], [0.14, 0, 0]);

  // ── 後視鏡 ──────────────────────────────────────────────────────────
  for (const side of [1, -1]) {
    const stalk = new Mesh(claySlab(0.1, 0.045, 0.045, { bevelRatio: 0.45 }), red);
    stalk.position.set(side * (HALF_WIDTH - 0.01), 0.85, 0.4);
    body.add(stalk);

    const mirror = new Mesh(clayBlob(0.065, 14), red);
    mirror.position.set(side * (HALF_WIDTH + 0.07), 0.86, 0.4);
    mirror.scale.set(0.8, 1, 1);
    body.add(mirror);
  }

  // 倒角外撐會讓最低點掉到地面以下。把整組抬到 min.y = 0，兌現「原點在
  // 車體正下方的地面」這個檔頭承諾——接地陰影與之後接進遊戲都靠這個。
  const bounds = new Box3().setFromObject(body);
  body.position.y -= bounds.min.y;

  return body;
}

function addSlab(
  parent: Group,
  material: ReturnType<typeof createClayMaterial>,
  size: [number, number, number],
  position: [number, number, number],
  rotation?: [number, number, number],
): Mesh {
  const mesh = new Mesh(claySlab(size[0], size[1], size[2]), material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  parent.add(mesh);
  return mesh;
}
