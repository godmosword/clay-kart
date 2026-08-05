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

export function forwardXZ(yaw: number): [number, number] {
  return [Math.sin(yaw), Math.cos(yaw)];
}

/**
 * 由玩家位置／朝向重建 follow-cam 的畫面右軸。
 * `pos` / `yaw` 應為渲染插值後的值（與畫面上看到的一致）。
 */
export function sampleFollowCam(
  pos: readonly [number, number, number],
  yaw: number,
  t = 0,
): SteerProbeSample {
  const [fx, fz] = forwardXZ(yaw);
  const [kx, ky, kz] = pos;
  const camPos: [number, number, number] = [
    kx - fx * FOLLOW_CAM.distance,
    ky + FOLLOW_CAM.height,
    kz - fz * FOLLOW_CAM.distance,
  ];
  const target: [number, number, number] = [
    kx + fx * FOLLOW_CAM.lookAhead,
    ky + FOLLOW_CAM.lookHeight,
    kz + fz * FOLLOW_CAM.lookAhead,
  ];

  // z = eye - target
  let zx = camPos[0] - target[0];
  let zy = camPos[1] - target[1];
  let zz = camPos[2] - target[2];
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

  return {
    t,
    pos: [kx, ky, kz],
    yaw,
    camPos,
    camRight: [rx, ry, rz],
  };
}

/** 車體位移在起始畫面右軸上的投影。>0 = 往畫面右邊，<0 = 往左邊。 */
export function screenLateral(
  start: Pick<SteerProbeSample, 'pos' | 'camRight'>,
  end: Pick<SteerProbeSample, 'pos'>,
): number {
  const dx = end.pos[0] - start.pos[0];
  const dy = end.pos[1] - start.pos[1];
  const dz = end.pos[2] - start.pos[2];
  const [rx, ry, rz] = start.camRight;
  return dx * rx + dy * ry + dz * rz;
}
