/**
 * 整車組裝：`kart-body`（#1）＋ `kart-wheels`（#2）＋ `driver-face`（#3）。
 *
 * 三個元件到 R19 為止都只在 `BAR-VISUAL §3` 的拍攝台上單獨拍過，遊戲畫面
 * 裡跑的還是 W1 的方塊車。這支檔案是把它們裝成一台真的車的地方——
 * `renderer.ts` 只負責把快照的位置／朝向套上去，不該知道車是由哪幾塊組成的。
 *
 * ## 兩種更新率在這裡分流（`CHARACTERS.md §3`，違反即整輪 FAIL）
 *
 * | 對象 | 更新率 | 這裡的入口 |
 * |---|---|---|
 * | 車體 transform | 60fps 插值 | 呼叫端直接設 `group.position`／`rotation` |
 * | 輪子自轉、轉向 | 60fps | `setWheelSpin()`／`setSteer()` |
 * | 臉（眨眼、表情） | **12fps 抽格** | `setExpressionTime()` |
 *
 * 抽格只實作在 `characters/driver-face.ts` 的 `setExpressionTime()` 裡面，
 * 這裡純轉發——量化寫兩份，遲早有一份會漏掉。
 */
import { Box3, Group, Mesh } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createDriverFace } from '../../characters/driver-face.js';
import { createKartBody } from './kart-body.js';
import { createKartWheelSet, WHEEL_ROLLING_RADIUS } from './kart-wheels.js';
import { createClayMaterial } from '../clay/material.js';

export { WHEEL_ROLLING_RADIUS };

/**
 * 臉在車頭的擺放——**眼睛與笑口分開擺在兩個曲面上**。
 *
 * 參考圖（`refs/clay/characters/小紅賽車.jpg`）上，白色臉盤與大圓眼壓在前擋
 * 斜面，笑口是另一塊黏土壓在前保險桿，中間隔著一整個引擎蓋的落差。
 * R20 把整張臉當剛性一塊掛上去，笑口因此沉進引擎蓋、正面看不到，違反
 * `CHARACTERS.md §4` 與 `BAR-VISUAL §5.3`。傾角試過三檔都無解——甲蟲車的
 * 車頭有兩個朝向差很多的曲面，一塊平板貼不住兩個。R21 把臉拆成兩部分。
 *
 * 眼睛的傾角對齊 `clay/profile.ts` 前擋那段輪廓：由 `(z=0.56, y=0.70)` 升到
 * `(z=0.30, y=1.00)`，往後仰約 40°。擠出件的倒角會把實際表面再往外推一圈，
 * 所以擺放點比輪廓座標再往前上方一點，臉才是「壓上去」不是「埋進去」。
 */
const EYES_MOUNT = { y: 0.95, z: 0.52 } as const;

/** 眼睛往後仰的角度（弧度）。負值＝頂端往車尾倒，跟前擋斜面同向。 */
const EYES_TILT_X = -0.6;

/**
 * 笑口在鼻頭正面的高度，以及要從鼻頭最前端往內縮多少。
 *
 * `z` 不寫死：鼻頭實際位置是 `kart-body` 的包圍盒算出來的（輪廓擠出的倒角
 * 會把表面往外推，照輪廓座標擺會埋進殼裡——`kart-body.ts` 的頭燈也踩過同一
 * 個坑）。往內縮一點點，笑口才是壓在鼻頭上而不是浮在前面。
 */
const MOUTH_MOUNT = { y: 0.4, inset: 0.06 } as const;

/** 笑口略為朝上，貼合鼻頭下半段往內收的弧度。 */
const MOUTH_TILT_X = 0.22;

/** 臉相對車身的大小。參考圖上臉幾乎佔滿車頭正面。 */
const FACE_SCALE = 1.3;

/** 笑口比眼睛再小一階：保險桿的可用面積比前擋窄。 */
const MOUTH_SCALE = 1.5;

/** 滿舵時前輪的視覺轉向角（弧度）。純表演，不影響物理。 */
const MAX_VISUAL_STEER = 0.42;

export interface KartVisualOptions {
  /** 車身主色，見 `kart-body.ts` 的 `KartBodyOptions`。 */
  bodyColor?: number;
}

export interface KartVisual {
  /** 整台車。原點在車體正下方的地面，forward = `+Z`。 */
  group: Group;
  /**
   * 輪子累積滾動角。呼叫端傳**距離**，換算成角度在這裡做——
   * 滾動半徑屬於輪子元件的細節，不該外流到 `renderer.ts`。
   */
  setRolledDistance(metres: number): void;
  /** 轉向輸入 `[-1, 1]`，映射到前輪的視覺轉角。 */
  setSteerInput(steer: number): void;
  /** 表情時間軸（秒）。內部量化到 12fps，呼叫端傳原始時間即可。 */
  setExpressionTime(seconds: number): void;
}

/**
 * 遠處／非玩家車的低成本 gameplay 視覺。
 *
 * 場上最多三台 AI 車目前只有識別色，還沒有各自的角色造型；讓它們各自
 * 建立完整的小紅車會把 58 個 mesh 複製四次，並把每個零件送進即時陰影 pass。
 * 這個 proxy 保留車的比例、顏色與朝向，但只用一個圓角量體。玩家車仍走
 * `createKart()` 的完整元件組裝，拍攝台也不會使用這個 proxy。
 */
export function createKartProxy(bodyColor: number): KartVisual {
  const group = new Group();
  group.name = 'kart-proxy';

  const body = new Mesh(
    new RoundedBoxGeometry(1.28, 0.62, 2.15, 3, 0.13),
    createClayMaterial({ color: bodyColor, textureScale: 1.2 }),
  );
  body.position.y = 0.31;
  group.add(body);

  return {
    group,
    setRolledDistance(): void {
      // Proxy 沒有輪子幾何；車體 transform 仍由 renderer 每幀更新。
    },
    setSteerInput(): void {
      // Proxy 沒有前輪幾何；模擬側的 yaw 仍會旋轉整台車。
    },
    setExpressionTime(): void {
      // Proxy 沒有角色臉部動畫。
    },
  };
}

export function createKart(options: KartVisualOptions = {}): KartVisual {
  const group = new Group();
  group.name = 'kart';

  // `exactOptionalPropertyTypes` 下不能把 `undefined` 當「沒給」傳下去，
  // 所以有值才建那個欄位，讓預設值留在 `kart-body.ts` 那一層。
  const body = createKartBody(
    options.bodyColor === undefined ? {} : { bodyColor: options.bodyColor },
  );
  group.add(body);

  const wheels = createKartWheelSet();
  group.add(wheels.group);

  // 鼻頭最前端。跟 `kart-body.ts` 擺頭燈同一個做法：從實際包圍盒取表面位置，
  // 不相信輪廓座標——倒角會把表面往外推一圈。
  const noseZ = new Box3().setFromObject(body).max.z;

  const face = createDriverFace();

  // 眼睛：前擋斜面。
  face.eyes.position.set(0, EYES_MOUNT.y, EYES_MOUNT.z);
  face.eyes.rotation.x = EYES_TILT_X;
  face.eyes.scale.setScalar(FACE_SCALE);
  group.add(face.eyes);

  // 笑口：鼻頭正面，另一個曲面。`createDriverFace()` 預設把兩者組成完整一張
  // 臉，這裡改掛到車身上並各自定位——所以 `face.group` 不加進場景。
  face.mouth.position.set(0, MOUTH_MOUNT.y, noseZ - MOUTH_MOUNT.inset);
  face.mouth.rotation.x = MOUTH_TILT_X;
  face.mouth.scale.setScalar(MOUTH_SCALE);
  group.add(face.mouth);

  return {
    group,
    setRolledDistance(metres: number): void {
      wheels.setSpin(metres / WHEEL_ROLLING_RADIUS);
    },
    setSteerInput(steer: number): void {
      // 正的 steer 讓 `world.ts` 的 yaw 增加，車頭因此轉向 `+X`（實測：
      // steer=+1 時 yaw 0→0.667、速度變成 `(+8.81, +15.05)`）。輪子要指向
      // 車真正會去的方向，所以同號——繞 Y 的正旋轉正是把 `+Z` 帶向 `+X`。
      wheels.setSteer(steer * MAX_VISUAL_STEER);
    },
    setExpressionTime(seconds: number): void {
      face.setExpressionTime(seconds);
    },
  };
}
