#!/usr/bin/env node

/** Deterministic headless replay: fixture -> BAR-FEEL telemetry JSON. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  buildSha,
  inputAt,
  loadSimulation,
  readFixture,
} from './runtime.mjs';

const fixturePath = process.argv[2] ?? 'fixtures/lap-a.json';
const outputPath = process.argv[3] ?? 'telemetry/lap-a.json';
const fixture = await readFixture(fixturePath);
const { createWorld, advance, BASE_TOP_SPEED, CAR_LENGTH, CAR_WIDTH, TRACK_GEOMETRY, TICK_HZ } = await loadSimulation();

function frameFromSnapshot(snapshot) {
  const kart = snapshot.kart;
  return {
    t: snapshot.t,
    tick: snapshot.tick,
    pos: [...kart.pos],
    vel: [...kart.vel],
    speed: kart.speed,
    yaw: kart.yaw,
    yaw_rate: kart.yawRate,
    steer_input: kart.steerInput,
    throttle_input: kart.throttleInput,
    drift_state: kart.driftState,
    drift_charge: kart.driftCharge,
    drift_tier: kart.driftTier,
    grounded: kart.grounded,
    surface: kart.surface,
    collision_impulse: kart.collisionImpulse,
  };
}

function eventsBetween(previous, current) {
  const events = [];
  const tick = current.tick;
  if (previous.kart.grounded && !current.kart.grounded) {
    events.push({ tick, type: 'airborne_start', data: {} });
  }
  if (!previous.kart.grounded && current.kart.grounded) {
    events.push({ tick, type: 'landing', data: {} });
  }
  if (current.kart.collisionImpulse > 0) {
    events.push({
      tick,
      type: 'collision',
      data: { impulse: current.kart.collisionImpulse },
    });
  }
  if (previous.kart.driftState === 'none' && current.kart.driftState !== 'none') {
    events.push({ tick, type: 'drift_start', data: {} });
  }
  if (current.kart.driftTier > previous.kart.driftTier) {
    events.push({ tick, type: 'drift_tier_up', data: { tier: current.kart.driftTier } });
  }
  if (previous.kart.driftState === 'charging' && current.kart.driftState === 'released') {
    events.push({ tick, type: 'miniturbo_release', data: { tier: previous.kart.driftTier } });
  }
  return events;
}

function addReleaseDurations(events, frames) {
  for (const event of events) {
    if (event.type !== 'miniturbo_release') continue;
    const end = frames.find((frame) => frame.tick > event.tick && frame.drift_state === 'none');
    if (end) {
      event.data.duration_s = (end.tick - event.tick) / TICK_HZ;
    }
  }
}

async function replayOnce(inputTransform = (input) => input) {
  const world = createWorld();
  const frames = [];
  const events = [];
  let previous = world.snapshot();
  for (let tick = 0; tick < fixture.ticks; tick += 1) {
    // advance() owns the world.setInput() + world.step() ordering.
    advance(world, 1, () => inputTransform(inputAt(fixture, tick), tick));
    const current = world.snapshot();
    frames.push(frameFromSnapshot(current));
    events.push(...eventsBetween(previous, current));
    previous = current;
  }
  addReleaseDurations(events, frames);

  return {
    meta: {
      fixture: fixture.fixture,
      tick_hz: TICK_HZ,
      total_ticks: fixture.ticks,
      build_sha: buildSha(),
      seed: fixture.seed,
      replay_byte_identical: true,
      track_geometry: { ...TRACK_GEOMETRY },
      car_length: CAR_LENGTH,
      car_width: CAR_WIDTH,
      base_top_speed: BASE_TOP_SPEED,
    },
    frames,
    events,
  };
}

const driftReplays = await Promise.all([replayOnce(), replayOnce(), replayOnce()]);
const baseline = await replayOnce((input) => ({ ...input, drift: false }));
const releaseEvent = driftReplays[0].events.find((event) => event.type === 'miniturbo_release' && event.data?.tier === 2);
if (!releaseEvent) throw new Error('fixture did not produce a tier-2 miniturbo release');
const releaseTick = releaseEvent.tick;
const driftReleaseFrame = driftReplays[0].frames.find((frame) => frame.tick === releaseTick);
const driftAfterFrame = driftReplays[0].frames.find((frame) => frame.tick === releaseTick + 2 * TICK_HZ);
const straightReleaseFrame = baseline.frames.find((frame) => frame.tick === releaseTick);
const straightAfterFrame = baseline.frames.find((frame) => frame.tick === releaseTick + 2 * TICK_HZ);
if (!driftReleaseFrame || !driftAfterFrame || !straightReleaseFrame || !straightAfterFrame) {
  throw new Error('fixture is too short for the two-second tier-2 baseline');
}
const distance2d = (from, to) => Math.hypot(to.pos[0] - from.pos[0], to.pos[2] - from.pos[2]);
const driftDistance = distance2d(driftReleaseFrame, driftAfterFrame);
const straightDistance = distance2d(straightReleaseFrame, straightAfterFrame);
const baselines = {
  '2': {
    release_tick: releaseTick,
    drift_distance: driftDistance,
    straight_distance: straightDistance,
    car_lengths_gained: (driftDistance - straightDistance) / CAR_LENGTH,
  },
};
const activeDriftFrames = driftReplays[0].frames.filter((frame) => frame.drift_state !== 'none');
if (activeDriftFrames.length === 0) throw new Error('fixture did not produce drift frames');
const driftStartTick = activeDriftFrames[0].tick;
const driftEndTick = activeDriftFrames.at(-1).tick;
const baselineWindowFrames = baseline.frames.filter(
  (frame) => frame.tick >= driftStartTick && frame.tick <= driftEndTick,
);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const driftSpeedMean = mean(activeDriftFrames.map((frame) => frame.speed));
const baselineSpeedMean = mean(baselineWindowFrames.map((frame) => frame.speed));
if (baselineSpeedMean <= 0) throw new Error('baseline drift window has no speed');
const driftSpeedRetention = driftSpeedMean / baselineSpeedMean;
for (const replay of driftReplays) {
  replay.meta.baselines = baselines;
  replay.meta.drift_speed_retention = driftSpeedRetention;
}
const replays = driftReplays;
const serialized = replays.map((replay) => JSON.stringify(replay, null, 2) + '\n');
if (!(serialized[0] === serialized[1] && serialized[1] === serialized[2])) {
  throw new Error('ghost replay is not byte-identical across three runs');
}

const output = resolve(outputPath);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, serialized[0], 'utf8');
console.log(`ghost-replay: PASS (${fixture.fixture}, ${fixture.ticks} ticks) -> ${output}`);
