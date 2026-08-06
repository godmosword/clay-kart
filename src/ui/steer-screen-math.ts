/**
 * 追尾相機的螢幕左右軸（相機 local +X 在世界座標）。
 *
 * 必須與 `src/render/renderer.ts` 的 follow-cam 常數／lookAt 慣例一致——
 * 這裡不是第二套相機，是把同一條幾何算式抽成可測的純函式，讓 CDP 回歸
 * 能判斷「車體位移落在畫面左邊還是右邊」，而不只是「yaw 有沒有變」
 * （R20 轉向反向缺陷的根因：W1 只驗後者）。
 *
 * three.js `Matrix4.lookAt(eye, target, up)`：
 *   z = normalize(eye - target)
 *   x = normalize(cross(up, z))   ← 相機 local +X = 畫面右邊
 *
 * **熱路徑零配置：** `writeFollowCam(out, …)` 寫進呼叫端持有的緩衝；
 * 幀迴圈禁止呼叫會 new 的 `sampleFollowCam()`。
 */

/** 與 renderer.ts 同步。改那邊的相機就要改這裡，否則回歸會測錯軸。 */
export const FOLLOW_CAM = {
  distance: 8,
  height: 2.1,
  lookAhead: 4,
  lookHeight: 0.6,
} as const;

export interface SteerProbeSample {
  t: number;
  pos: [number, number, number];
  yaw: number;
  /** 世界座標下的相機位置（follow-cam）。 */
  camPos: [number, number, number];
  /** 世界座標下的相機 local +X（畫面右邊）。 */
  camRight: [number, number, number];
}

/** 一次配置、之後每幀重用。 */
export function createSteerProbeSample(): SteerProbeSample {
  return {
    t: 0,
    pos: [0, 0, 0],
    yaw: 0,
    camPos: [0, 0, 0],
    camRight: [0, 0, 0],
  };
}

/**
 * 由玩家位置／朝向重建 follow-cam 的畫面右軸，寫入 `out`（不 new）。
 */
export function writeFollowCam(
  out: SteerProbeSample,
  pos: readonly [number, number, number],
  yaw: number,
  t = 0,
): SteerProbeSample {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const kx = pos[0];
  const ky = pos[1];
  const kz = pos[2];

  const camX = kx - fx * FOLLOW_CAM.distance;
  const camY = ky + FOLLOW_CAM.height;
  const camZ = kz - fz * FOLLOW_CAM.distance;
  const targetX = kx + fx * FOLLOW_CAM.lookAhead;
  const targetY = ky + FOLLOW_CAM.lookHeight;
  const targetZ = kz + fz * FOLLOW_CAM.lookAhead;

  // z = eye - target
  let zx = camX - targetX;
  let zy = camY - targetY;
  let zz = camZ - targetZ;
  const zLen = Math.hypot(zx, zy, zz) || 1;
  zx /= zLen;
  zy /= zLen;
  zz /= zLen;

  // x = cross(up=(0,1,0), z) = (zz, 0, -zx)，再正規化
  let rx = zz;
  let ry = 0;
  let rz = -zx;
  const rLen = Math.hypot(rx, ry, rz) || 1;
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;

  out.t = t;
  out.yaw = yaw;
  out.pos[0] = kx;
  out.pos[1] = ky;
  out.pos[2] = kz;
  out.camPos[0] = camX;
  out.camPos[1] = camY;
  out.camPos[2] = camZ;
  out.camRight[0] = rx;
  out.camRight[1] = ry;
  out.camRight[2] = rz;
  return out;
}

/** 非熱路徑便利函式（會配置）。幀迴圈請用 `writeFollowCam`。 */
export function sampleFollowCam(
  pos: readonly [number, number, number],
  yaw: number,
  t = 0,
): SteerProbeSample {
  return writeFollowCam(createSteerProbeSample(), pos, yaw, t);
}

/** 車體位移在起始畫面右軸上的投影。>0 = 往畫面右邊，<0 = 往左邊。 */
export function screenLateral(
  start: Pick<SteerProbeSample, 'pos' | 'camRight'>,
  end: Pick<SteerProbeSample, 'pos'>,
): number {
  const dx = end.pos[0] - start.pos[0];
  const dy = end.pos[1] - start.pos[1];
  const dz = end.pos[2] - start.pos[2];
  const rx = start.camRight[0];
  const ry = start.camRight[1];
  const rz = start.camRight[2];
  return dx * rx + dy * ry + dz * rz;
}
