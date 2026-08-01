#!/usr/bin/env node

/**
 * W1 physics regression harness.
 *
 * Compile src/physics/world.ts to an ESM file first, then run:
 *
 *   node tools/validate/w1-physics.mjs [path/to/world.mjs]
 *
 * Keeping this harness in version control makes the deterministic and W1
 * invariants independently repeatable without a browser or Three.js.
 */
import { resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

let modulePath = process.argv[2];
if (!modulePath) {
  const assetDir = resolve('build/out/assets');
  const worldChunks = (await readdir(assetDir)).filter((file) => /^world-[^/]+\.js$/.test(file));
  if (worldChunks.length !== 1) {
    throw new Error('usage: node tools/validate/w1-physics.mjs /path/to/world.mjs (or run after a build with one world chunk)');
  }
  modulePath = resolve(assetDir, worldChunks[0]);
}

const { createWorld, TRACK_GEOMETRY } = await import(pathToFileURL(resolve(modulePath)).href);
if (TRACK_GEOMETRY === undefined) {
  throw new Error('physics module must export TRACK_GEOMETRY from @physics/constants');
}
const DT = 1 / 120;
const { centerX, centerZ, radius: TRACK_RADIUS, halfWidth: TRACK_HALF_WIDTH } = TRACK_GEOMETRY;
const KART_BOUNDING_RADIUS = Math.hypot(1.2, 0.7);
const INNER_BOUNDARY = TRACK_RADIUS - TRACK_HALF_WIDTH + KART_BOUNDING_RADIUS;
const OUTER_BOUNDARY = TRACK_RADIUS + TRACK_HALF_WIDTH - KART_BOUNDING_RADIUS;

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function assertClose(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
}

function runSequence(ticks, inputAtTick) {
  const world = createWorld();
  const frames = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    inputAtTick?.(world, tick);
    world.step(DT);
    frames.push(JSON.stringify(world.snapshot()));
  }
  return frames.join('\n');
}

function runUntilLaps() {
  const world = createWorld();
  world.setInput({ throttle: 1, steer: -0.3 });
  let snapshot = world.snapshot();
  for (let tick = 0; tick < 120 * 200; tick += 1) {
    world.step(DT);
    snapshot = world.snapshot();
    if (snapshot.lap.splits.length === 3) return snapshot;
  }
  return snapshot;
}

// 1–2. Determinism is byte-identical for both default and controlled input.
const defaultReplay = [runSequence(3000), runSequence(3000), runSequence(3000)];
assert(defaultReplay[0] === defaultReplay[1] && defaultReplay[1] === defaultReplay[2], 'default replay is not byte-identical');
const driven = (world, tick) => world.setInput({ throttle: 1, steer: Math.sin(tick / 97) * 0.3 });
assert(runSequence(3000, driven) === runSequence(3000, driven), 'steered replay is not byte-identical');

// 3. Released steering has no hidden track-curvature yaw rate.
{
  const world = createWorld();
  world.setInput({ throttle: 1, steer: 0.8 });
  for (let tick = 0; tick < 240; tick += 1) world.step(DT);
  const during = world.snapshot().kart.yawRate;
  assert(Math.abs(during) > 0.001, 'steering did not produce yaw rate');
  world.setInput({ steer: 0 });
  let settled = null;
  for (let tick = 0; tick < 600; tick += 1) {
    world.step(DT);
    if (settled === null && Math.abs(world.snapshot().kart.yawRate) < Math.abs(during) * 0.05) {
      settled = tick * DT;
    }
  }
  assert(settled !== null && settled <= 0.35, `yaw did not settle in window: ${settled}`);
}

// 4–5. Free integration reaches the wall without centreline snapping or penetration.
{
  const world = createWorld();
  let maxPenetration = 0;
  let touchedWall = false;
  for (let tick = 0; tick < 120 * 60; tick += 1) {
    world.step(DT);
    const snapshot = world.snapshot();
    const [x, y, z] = snapshot.kart.pos;
    assert([x, y, z, snapshot.kart.speed, snapshot.kart.yaw].every(Number.isFinite), `non-finite frame ${tick + 1}`);
    const radius = Math.hypot(x - centerX, z - centerZ);
    maxPenetration = Math.max(
      maxPenetration,
      Math.max(0, radius - OUTER_BOUNDARY),
      Math.max(0, INNER_BOUNDARY - radius),
    );
    if (Math.abs(radius - OUTER_BOUNDARY) < 0.001 || Math.abs(radius - INNER_BOUNDARY) < 0.001) {
      touchedWall = true;
    }
  }
  assert(touchedWall, 'zero-steer physical integration never reached a wall');
  assert(Math.abs(Math.hypot(world.snapshot().kart.pos[0] - centerX, world.snapshot().kart.pos[2] - centerZ) - TRACK_RADIUS) > 0.1, 'position is still snapped to centreline');
  assert(maxPenetration <= 0.05, `wall penetration exceeded BAR-FEEL §2.3: ${maxPenetration}`);
}

// 6. A steerable line can still complete three laps and report bestTime.
{
  const snapshot = runUntilLaps();
  assert(snapshot.lap.splits.length === 3, `expected 3 lap splits, got ${snapshot.lap.splits.length}`);
  assert(snapshot.lap.current === 3 && snapshot.lap.total === 3, 'lap state did not finish at 3/3');
  assertClose(snapshot.lap.bestTime, Math.min(...snapshot.lap.splits), 1e-12, 'bestTime');
}

// 7. Existing acceleration/reverse windows remain unchanged on a valid line.
{
  const world = createWorld();
  world.setInput({ throttle: 1, steer: -0.3 });
  let t50 = null;
  let t95 = null;
  let topSpeed = 0;
  for (let tick = 0; tick < 120 * 30; tick += 1) {
    world.step(DT);
    const snapshot = world.snapshot();
    topSpeed = Math.max(topSpeed, snapshot.kart.speed);
    if (t50 === null && snapshot.kart.speed >= 12) t50 = snapshot.t;
    if (t95 === null && snapshot.kart.speed >= 22.8) t95 = snapshot.t;
  }
  assert(t50 >= 0.55 && t50 <= 0.85, `time_to_50pct out of window: ${t50}`);
  assert(t95 >= 2.6 && t95 <= 3.4, `time_to_95pct out of window: ${t95}`);
  assert(topSpeed >= 23.5 && topSpeed <= 24.5, `top speed out of window: ${topSpeed}`);

  const reverse = createWorld();
  reverse.setInput({ throttle: 1, steer: -0.001, reverse: true });
  let minimumLongitudinal = 0;
  for (let tick = 0; tick < 120 * 8; tick += 1) {
    reverse.step(DT);
    const snapshot = reverse.snapshot();
    const forward = [Math.sin(snapshot.kart.yaw), Math.cos(snapshot.kart.yaw)];
    minimumLongitudinal = Math.min(
      minimumLongitudinal,
      snapshot.kart.vel[0] * forward[0] + snapshot.kart.vel[2] * forward[1],
    );
  }
  const reverseRatio = Math.abs(minimumLongitudinal) / 24;
  assert(reverseRatio >= 0.30 && reverseRatio <= 0.42, `reverse ratio out of window: ${reverseRatio}`);
}

// 8. The loader owns the fixed-step value; the world locks the first value it receives.
{
  const world = createWorld();
  world.step(1 / 60);
  assertClose(world.snapshot().t, 1 / 60, 1e-15, 'loader-provided fixed dt');
  let rejected = false;
  try {
    world.step(1 / 120);
  } catch {
    rejected = true;
  }
  assert(rejected, 'variable dt was accepted after the fixed step was established');
}

console.log('W1 physics regression: PASS');
