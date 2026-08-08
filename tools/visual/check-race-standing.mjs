#!/usr/bin/env node
/**
 * race-standing 回歸（R30）：玩家 completed laps 較少、軌道角卻較大時，
 * 不得被排成第 1——抓「只比角度、忘了圈數」的公式崩壞。
 *
 * 直接載入 `src/ui/race-standing.ts`（Node strip-types；該檔對 sim 只有
 * `import type`，執行期無 path-alias 依賴）。
 *
 * Usage:
 *   node --experimental-strip-types tools/visual/check-race-standing.mjs
 *   npm run test:race-standing
 */
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STANDING_TS = resolve(HERE, '../../src/ui/race-standing.ts');

const TRACK_CENTER_X = 0;
const TRACK_CENTER_Z = 30;
const TRACK_RADIUS = 30;

function posAtAngle(angle) {
  return [
    TRACK_CENTER_X + TRACK_RADIUS * Math.cos(angle),
    0,
    TRACK_CENTER_Z + TRACK_RADIUS * Math.sin(angle),
  ];
}

function stubKart(pos) {
  return {
    characterId: 'xiaohong',
    pos,
    vel: [0, 0, 0],
    speed: 0,
    yaw: 0,
    yawRate: 0,
    steerInput: 0,
    throttleInput: 0,
    driftState: 'none',
    driftCharge: 0,
    driftTier: 0,
    grounded: true,
    surface: 'asphalt',
    collisionImpulse: 0,
  };
}

function stubLap(current) {
  return {
    current,
    total: 3,
    currentTime: 0,
    bestTime: null,
    splits: [],
  };
}

const { playerStanding } = await import(pathToFileURL(STANDING_TS).href);

// 玩家：第 1 圈、角度接近一圈末（大）。對手：已進第 2 圈、角度剛過線（小）。
// 若公式退化成「只比角度」，玩家會被誤排第 1。
const playerAngle = 5.5;
const leaderAngle = 0.2;
const snap = {
  tick: 1,
  t: 0,
  playerIndex: 0,
  karts: [stubKart(posAtAngle(playerAngle)), stubKart(posAtAngle(leaderAngle))],
  laps: [stubLap(1), stubLap(2)],
};

const standing = playerStanding(snap);
const failures = [];

if (standing.place === 1) {
  failures.push(
    `player with fewer completed laps but larger track angle ranked place=1 ` +
      `(field=${standing.field}); formula likely ignores lap count`,
  );
}
if (standing.place !== 2) {
  failures.push(`expected place=2 (one car a lap ahead), got ${standing.place}`);
}
if (standing.field !== 2) {
  failures.push(`expected field=2, got ${standing.field}`);
}

if (failures.length > 0) {
  console.error(JSON.stringify({ ok: false, standing, failures }, null, 2));
  console.error('\nrace-standing: FAIL');
  for (const f of failures) console.error(' -', f);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, standing }, null, 2));
  console.error('\nrace-standing: PASS');
}
