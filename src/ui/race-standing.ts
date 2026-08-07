/**
 * 名次是顯示用衍生值——由 SimSnapshot 的 laps + 車位置推算。
 * 不寫回模擬、不依賴物理內部狀態（FROZEN 的 world.ts 只讀契約面）。
 *
 * 進度：完成圈數 × 2π + 目前軌道角（與 world 的 atan2(z-cz, x-cx) 同慣例）。
 */
import type { SimSnapshot } from '@contract/sim';

/** 與 `TRACK_GEOMETRY` 相同的中心——UI 只複製常數，不 import 凍結的 physics。 */
const TRACK_CENTER_X = 0;
const TRACK_CENTER_Z = 30;
const FULL_TURN = Math.PI * 2;

function wrapAngle(angle: number): number {
  const wrapped = angle % FULL_TURN;
  return wrapped < 0 ? wrapped + FULL_TURN : wrapped;
}

function trackProgress(snap: SimSnapshot, index: number): number {
  const lap = snap.laps[index];
  const kart = snap.karts[index];
  if (!lap || !kart) return Number.NEGATIVE_INFINITY;
  const [x, , z] = kart.pos;
  const angle = wrapAngle(Math.atan2(z - TRACK_CENTER_Z, x - TRACK_CENTER_X));
  // lap.current 是「正在跑第幾圈」（從 1 起）；已完成圈數 = current - 1
  const completed = Math.max(0, lap.current - 1);
  return completed * FULL_TURN + angle;
}

export interface RaceStanding {
  /** 1 = 第一名 */
  place: number;
  /** 場上車輛數 */
  field: number;
}

/** 玩家目前名次（1-based）與場上車數。 */
export function playerStanding(snap: SimSnapshot): RaceStanding {
  const field = snap.karts.length;
  if (field <= 0) return { place: 1, field: 1 };

  const playerProgress = trackProgress(snap, snap.playerIndex);
  let ahead = 0;
  for (let i = 0; i < field; i += 1) {
    if (i === snap.playerIndex) continue;
    if (trackProgress(snap, i) > playerProgress) ahead += 1;
  }
  return { place: ahead + 1, field };
}
