/**
 * `BAR-VISUAL §4` 元件 #2：`kart-wheels`——輪胎、輪框、形變。
 *
 * `CHARACTERS.md §4`：「玩具模型尺度，不是寫實比例。車身短胖，**輪子大
 * 而圓**」。所以胎面渾圓厚實，不是薄薄一圈橡膠。
 *
 * `CHARACTERS.md §3` 把輪子明確歸在**載具**側：「輪子自轉、懸吊 → 60fps，
 * 屬載具，不是角色」。所以這個元件放在 `src/render/`（載具），臉才放
 * `src/characters/`（純表演）。這個分界不是分類潔癖——§3 是「違反即整輪
 * FAIL」的規則，把兩種更新率的東西放在不同目錄，寫錯的機會小得多。
 *
 * 「形變」的處理：黏土輪子是捏出來的，不會是完美正圓。這裡讓胎面在接地
 * 側略扁，模擬承重——不是物理模擬，是靜態造型上的暗示。
 */
import { Group, Mesh, TorusGeometry, CylinderGeometry } from 'three';
import { clayBlob } from '../clay/geometry.js';
import { createClayMaterial } from '../clay/material.js';
import { TIRE } from '../clay/palette.js';

/** 胎面中心半徑與胎厚。相加＝輪子外半徑 0.355，剛好讓輪軸落在 0.36。 */
const TREAD_RADIUS = 0.24;
const TREAD_THICKNESS = 0.115;

/**
 * 滾動半徑。接進遊戲後自轉角速度 = 速度 / 這個值——寫死在呼叫端會在
 * 胎厚一改就悄悄不同步，所以由本檔案匯出。
 */
export const WHEEL_ROLLING_RADIUS = TREAD_RADIUS + TREAD_THICKNESS;

/**
 * 輪軸位置。`components/kart-body.ts` 的擋泥板照這些座標外鼓，接遊戲時
 * 的輪組也用這些值——兩邊各寫一份遲早會漂移。
 */
export const WHEEL_AXLE = {
  x: 0.6,
  y: 0.36,
  frontZ: 0.72,
  rearZ: -0.7,
} as const;

/** 輪寬方向的壓扁量——黏土輪子比橡膠輪胎胖，但不能胖到變成球。 */
const WHEEL_WIDTH_SCALE = 0.82;

/** 承重造成的接地側微扁。1 = 正圓，越小越扁。 */
const LOAD_SQUASH = 0.965;

/**
 * 單顆輪子。原點在**輪心**（不是地面），方便直接掛到車軸位置。
 *
 * 元件審查用這個：一顆輪子放大看得到胎面、輪框、輪轂與黏土壓痕；四顆
 * 排在一起反而每顆都小到看不出材質。遊戲用 `createKartWheelSet()`。
 */
export function createKartWheel(): Group {
  const wheel = new Group();
  wheel.name = 'kart-wheel';

  const rubber = createClayMaterial({
    color: TIRE.rubber,
    // 橡膠比車身再霧一點，深色表面的高光最容易露出「塑膠感」。
    roughness: 0.96,
    textureScale: 2.4,
  });
  const rim = createClayMaterial({ color: TIRE.rim, textureScale: 2.8 });
  const hub = createClayMaterial({ color: TIRE.hub, textureScale: 4 });

  // 胎面：厚實的圓環。輪軸沿 X，所以環面躺在 YZ 平面。
  const tread = new Mesh(
    new TorusGeometry(TREAD_RADIUS, TREAD_THICKNESS, 14, 30),
    rubber,
  );
  tread.rotation.y = Math.PI * 0.5;
  tread.scale.set(1, LOAD_SQUASH, 1);
  wheel.add(tread);

  // 輪框：填滿圓環中央的奶油色圓盤，兩側各一。
  for (const side of [1, -1]) {
    const disc = new Mesh(
      new CylinderGeometry(TREAD_RADIUS * 0.92, TREAD_RADIUS * 0.92, 0.06, 26),
      rim,
    );
    disc.rotation.z = Math.PI * 0.5;
    disc.position.x = side * TREAD_THICKNESS * 0.62;
    disc.scale.set(LOAD_SQUASH, 1, 1);
    wheel.add(disc);

    // 輪轂：紅色小圓心，參考圖上每顆輪子中央都有。
    const centre = new Mesh(clayBlob(0.085, 14), hub);
    centre.position.x = side * (TREAD_THICKNESS * 0.62 + 0.02);
    centre.scale.set(0.5, 1, 1);
    wheel.add(centre);
  }

  wheel.scale.x = WHEEL_WIDTH_SCALE;
  return wheel;
}

/**
 * 遊戲用的四顆輪組。
 *
 * `CHARACTERS.md §3`：「輪子自轉、懸吊 → 60fps，**屬載具，不是角色**」。
 * 所以這裡回傳的兩支控制方法都吃連續值，**不做任何抽格**——抽格只發生在
 * `src/characters/` 那側。
 *
 * 自轉與轉向分兩層 `Group`：外層繞 Y 轉向、內層繞 X 自轉。寫成同一個
 * `Object3D` 的兩軸尤拉角看似省事，但兩軸都不為零時的合成順序會讓轉向中的
 * 輪子看起來在歪著滾。
 */
export interface KartWheelSet {
  group: Group;
  /** 累積滾動角（弧度）。呼叫端算 `距離 / WHEEL_ROLLING_RADIUS`。 */
  setSpin(radians: number): void;
  /** 前輪轉向角（弧度）。後輪不轉。 */
  setSteer(radians: number): void;
}

export function createKartWheelSet(): KartWheelSet {
  const group = new Group();
  group.name = 'kart-wheels';

  const spinners: Group[] = [];
  const steerers: Group[] = [];

  for (const z of [WHEEL_AXLE.frontZ, WHEEL_AXLE.rearZ]) {
    for (const side of [1, -1]) {
      const steer = new Group();
      steer.position.set(side * WHEEL_AXLE.x, WHEEL_AXLE.y, z);

      const spin = new Group();
      spin.add(createKartWheel());
      steer.add(spin);

      group.add(steer);
      spinners.push(spin);
      if (z === WHEEL_AXLE.frontZ) steerers.push(steer);
    }
  }

  return {
    group,
    setSpin(radians: number): void {
      for (const spin of spinners) spin.rotation.x = radians;
    },
    setSteer(radians: number): void {
      for (const steer of steerers) steer.rotation.y = radians;
    },
  };
}
