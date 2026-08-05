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
import { Group } from 'three';
import { createDriverFace } from '../../characters/driver-face.js';
import { createKartBody } from './kart-body.js';
import { createKartWheelSet, WHEEL_ROLLING_RADIUS } from './kart-wheels.js';

export { WHEEL_ROLLING_RADIUS };

/**
 * 臉在車頭的擺放。
 *
 * 參考圖（`refs/clay/characters/小紅賽車.jpg`）上臉是**壓在前擋斜面上的一塊
 * 獨立黏土**，笑口再往下落在引擎蓋／保險桿上——不是畫在車殼上的貼圖。
 * 這裡的傾角對齊 `clay/profile.ts` 前擋那段輪廓：由 `(z=0.56, y=0.70)` 升到
 * `(z=0.30, y=1.00)`，也就是往後仰約 40°。擠出件的倒角會把實際表面再往外
 * 推一圈，所以擺放點比輪廓座標再往前上方一點，臉才是「壓上去」不是「埋進去」。
 *
 * ## 已知缺口：笑口被引擎蓋擋住
 *
 * `driver-face` 是**一整塊平板**，笑口就在眼睛正下方約 0.2 單位處；而
 * `kart-body` 是甲蟲車，前擋之下立刻接一段幾乎水平的引擎蓋。兩者剛性組合
 * 時，眼睛擺得好看笑口就沉進引擎蓋，笑口露出來眼睛就得抬到車頂高度——
 * 試過傾角 `-0.25`／`-0.6`／`-0.85` 三檔，`-0.85` 能讓笑口浮出蓋面，但變成
 * 朝上，正面仍然看不到，而且臉整個像躺著。
 *
 * 這是**元件層級的造型問題，不是擺放參數問題**（參考圖上的臉能同時做到，
 * 是因為眼睛在前擋、笑口在保險桿，中間隔著一整個引擎蓋的落差，等於臉不是
 * 剛性的一塊）。接線這一輪不改元件造型——會分不清回歸是接線造成還是改造型
 * 造成。這裡選的是眼睛讀得最清楚的一檔，笑口缺口記進 `loop/BACKLOG.md`，
 * 由下一輪 `driver-face` 處理。`CHARACTERS.md §4` 的「大圓眼 + 明確笑口」
 * 目前只做到前半。
 */
const FACE_MOUNT = { y: 0.95, z: 0.52 } as const;

/** 往後仰的角度（弧度）。負值＝頂端往車尾倒，跟前擋斜面同向。 */
const FACE_TILT_X = -0.6;

/** 臉相對車身的大小。參考圖上臉幾乎佔滿車頭正面。 */
const FACE_SCALE = 1.3;

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

export function createKart(options: KartVisualOptions = {}): KartVisual {
  const group = new Group();
  group.name = 'kart';

  // `exactOptionalPropertyTypes` 下不能把 `undefined` 當「沒給」傳下去，
  // 所以有值才建那個欄位，讓預設值留在 `kart-body.ts` 那一層。
  group.add(createKartBody(options.bodyColor === undefined ? {} : { bodyColor: options.bodyColor }));

  const wheels = createKartWheelSet();
  group.add(wheels.group);

  const face = createDriverFace();
  face.group.position.set(0, FACE_MOUNT.y, FACE_MOUNT.z);
  face.group.rotation.x = FACE_TILT_X;
  face.group.scale.setScalar(FACE_SCALE);
  group.add(face.group);

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
