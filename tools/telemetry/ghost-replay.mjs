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

function groundSpeed(value) {
  return Math.hypot(value.vel[0], value.vel[2]);
}

function collisionData(previousKart, currentKart) {
  const dx = currentKart.pos[0] - TRACK_GEOMETRY.centerX;
  const dz = currentKart.pos[2] - TRACK_GEOMETRY.centerZ;
  const radialDistance = Math.hypot(dx, dz);
  const radialX = radialDistance > 0 ? dx / radialDistance : 1;
  const radialZ = radialDistance > 0 ? dz / radialDistance : 0;
  const kartRadius = Math.hypot(CAR_LENGTH / 2, CAR_WIDTH / 2);
  const innerBoundary = TRACK_GEOMETRY.radius - TRACK_GEOMETRY.halfWidth + kartRadius;
  const outerBoundary = TRACK_GEOMETRY.radius + TRACK_GEOMETRY.halfWidth - kartRadius;
  const isOuterWall = Math.abs(radialDistance - outerBoundary)
    <= Math.abs(radialDistance - innerBoundary);
  const wallNormal = isOuterWall
    ? [radialX, radialZ]
    : [-radialX, -radialZ];
  const previousGroundSpeed = groundSpeed(previousKart);
  const currentGroundSpeed = groundSpeed(currentKart);
  const previousNormalSpeed = previousGroundSpeed > 0
    ? (previousKart.vel[0] * wallNormal[0] + previousKart.vel[2] * wallNormal[1]) / previousGroundSpeed
    : 0;
  const normalAngle = previousGroundSpeed > 0
    ? Math.acos(Math.max(-1, Math.min(1, previousNormalSpeed))) * 180 / Math.PI
    : 90;
  return {
    wall: isOuterWall ? 'outer' : 'inner',
    wall_normal: wallNormal,
    normal_angle_deg: normalAngle,
    pre_speed: previousKart.speed,
    post_speed: currentKart.speed,
    pre_ground_speed: previousGroundSpeed,
    post_ground_speed: currentGroundSpeed,
    wall_speed_retention: previousGroundSpeed > 0 ? currentGroundSpeed / previousGroundSpeed : 0,
    pre_yaw_rate: previousKart.yawRate,
    post_yaw_rate: currentKart.yawRate,
  };
}

function landingData(previousKart, currentKart) {
  const previousGroundSpeed = groundSpeed(previousKart);
  const currentGroundSpeed = groundSpeed(currentKart);
  const descentSpeed = Math.abs(previousKart.vel[1]);
  const landingAngleDeg = Math.atan2(previousGroundSpeed, descentSpeed) * 180 / Math.PI;
  return {
    pre_speed: previousKart.speed,
    post_speed: currentKart.speed,
    pre_ground_speed: previousGroundSpeed,
    post_ground_speed: currentGroundSpeed,
    pre_vertical_speed: previousKart.vel[1],
    post_vertical_speed: currentKart.vel[1],
    landing_angle_deg: landingAngleDeg,
    speed_retention: previousGroundSpeed > 0 ? currentGroundSpeed / previousGroundSpeed : 0,
  };
}

function eventsBetween(previous, current) {
  const events = [];
  const tick = current.tick;
  if (previous.kart.grounded && !current.kart.grounded) {
    events.push({ tick, type: 'airborne_start', data: {} });
  }
  if (!previous.kart.grounded && current.kart.grounded) {
    events.push({
      tick,
      type: 'landing',
      data: {
        ...landingData(previous.kart, current.kart),
        latency_ticks: current.tick - previous.tick - 1,
      },
    });
  }
  if (current.kart.collisionImpulse > 0) {
    events.push({
      tick,
      type: 'collision',
      data: {
        impulse: current.kart.collisionImpulse,
        phase: previous.kart.collisionImpulse > 0 ? 'contact' : 'impact',
        ...collisionData(previous.kart, current.kart),
      },
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

function annotateCollisionRecovery(events, frames) {
  const collisionEvents = events.filter(
    (event) => event.type === 'collision' && event.data?.phase === 'impact',
  );
  for (const event of collisionEvents) {
    const impactIndex = frames.findIndex((frame) => frame.tick === event.tick);
    if (impactIndex < 0) continue;
    const reference = event.data;
    const speedFloor = Number(reference.pre_ground_speed) * 0.5;
    const preYawRate = Number(reference.pre_yaw_rate);
    let recoveryFrame = null;
    for (let index = impactIndex + 1; index < frames.length - 1; index += 1) {
      const first = frames[index];
      const second = frames[index + 1];
      const expectedFirstYaw = preYawRate * Math.min(2, groundSpeed(first) / Math.max(speedFloor * 2, 1e-9));
      const expectedSecondYaw = preYawRate * Math.min(2, groundSpeed(second) / Math.max(speedFloor * 2, 1e-9));
      const firstControlled = first.grounded
        && first.collision_impulse <= 0
        && groundSpeed(first) >= speedFloor
        && Math.abs(first.yaw_rate - expectedFirstYaw) <= Math.max(0.05, Math.abs(expectedFirstYaw) * 0.25);
      const secondControlled = second.grounded
        && second.collision_impulse <= 0
        && groundSpeed(second) >= speedFloor
        && Math.abs(second.yaw_rate - expectedSecondYaw) <= Math.max(0.05, Math.abs(expectedSecondYaw) * 0.25);
      if (firstControlled && secondControlled) {
        recoveryFrame = first;
        break;
      }
    }
    event.data.recovery_time_s = recoveryFrame
      ? (recoveryFrame.t - (event.tick / TICK_HZ))
      : null;
    event.data.recovery_definition = 'first two consecutive grounded, collision-free frames above 50% pre-impact ground speed with yaw-rate error <= max(0.05, 25% expected)';
  }
}

function annotateLandingTelemetry(events) {
  const airborneStarts = events
    .filter((event) => event.type === 'airborne_start')
    .map((event) => event.tick);
  for (const event of events) {
    if (event.type !== 'landing') continue;
    const startTick = airborneStarts.filter((tick) => tick < event.tick).at(-1);
    if (startTick !== undefined) {
      event.data.airborne_start_tick = startTick;
      event.data.airborne_duration_ticks = event.tick - startTick;
    }
    event.data.landing_angle_definition = 'angle between pre-landing ground velocity and downward vertical; >=45° smooth, <45° steep';
  }
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

async function replayTicks(totalTicks, inputAtTick, fixtureName, seed) {
  const world = createWorld();
  const frames = [];
  const events = [];
  let previous = world.snapshot();
  for (let tick = 0; tick < totalTicks; tick += 1) {
    // advance() owns the world.setInput() + world.step() ordering.
    advance(world, 1, () => inputAtTick(tick));
    const current = world.snapshot();
    frames.push(frameFromSnapshot(current));
    events.push(...eventsBetween(previous, current));
    previous = current;
  }
  addReleaseDurations(events, frames);
  annotateCollisionRecovery(events, frames);
  annotateLandingTelemetry(events);

  return {
    meta: {
      fixture: fixtureName,
      tick_hz: TICK_HZ,
      total_ticks: totalTicks,
      build_sha: buildSha(),
      seed,
      replay_byte_identical: true,
      track_geometry: { ...TRACK_GEOMETRY },
      car_length: CAR_LENGTH,
      car_width: CAR_WIDTH,
      base_top_speed: BASE_TOP_SPEED,
      collision_recovery_definition: 'first two consecutive grounded, collision-free frames above 50% pre-impact ground speed with yaw-rate error <= max(0.05, 25% expected)',
      kart_kart_collision_coverage: 'unavailable: SimSnapshot exposes one kart; deferred to ai-opponents',
      landing_angle_definition: 'angle between pre-landing ground velocity and downward vertical; >=45° smooth, <45° steep',
    },
    frames,
    events,
  };
}

async function replayOnce(inputTransform = (input) => input) {
  return replayTicks(
    fixture.ticks,
    (tick) => inputTransform(inputAt(fixture, tick), tick),
    fixture.fixture,
    fixture.seed,
  );
}

async function collisionProbe(name, steer, ticks = 300) {
  const replay = await replayTicks(
    ticks,
    () => ({ throttle: 1, steer, brake: false, reverse: false, drift: false, jump: false }),
    `collision-${name}`,
    `${fixture.seed}-${name}`,
  );
  return {
    name,
    steer,
    events: replay.events.filter((event) => event.type === 'collision'),
  };
}

async function landingProbe(name, inputAtTick, ticks = 320) {
  const replay = await replayTicks(
    ticks,
    inputAtTick,
    `landing-${name}`,
    `${fixture.seed}-${name}`,
  );
  return {
    name,
    events: replay.events.filter((event) => event.type === 'landing'),
  };
}

const driftReplays = await Promise.all([replayOnce(), replayOnce(), replayOnce()]);
const baseline = await replayOnce((input) => ({ ...input, drift: false }));
const collisionProbes = await Promise.all([
  collisionProbe('wall-30deg', -0.95),
  collisionProbe('wall-head-on', 1),
]);
const landingProbes = await Promise.all([
  landingProbe('smooth', (tick) => ({
    throttle: 1,
    steer: -0.2,
    brake: false,
    reverse: false,
    drift: false,
    jump: tick === 180,
  })),
  landingProbe('steep', (tick) => ({
    throttle: tick < 100 ? 1 : 0,
    steer: 0,
    brake: false,
    reverse: false,
    drift: false,
    jump: tick === 180,
  })),
]);
// Keep the gameplay fixture focused on the cross-section used by §2–§4 and
// §7.  The speed-radius checks need a sustained full-lock sweep, so collect
// that diagnostic series in a separate deterministic replay and attach only
// its scalar samples to telemetry metadata.
const steeringCalibration = await replayOnce((input, tick) => {
  if (tick >= 731 && tick < 1400) {
    return { throttle: 1, steer: -1, brake: false, reverse: false, drift: false, jump: false };
  }
  if (tick >= 1400 && tick < 6000) {
    return { throttle: 1, steer: -1, brake: true, reverse: false, drift: false, jump: false };
  }
  return input;
});
const steeringRadiusSamples = steeringCalibration.frames
  .filter((frame) => (
    Math.abs(frame.steer_input) >= 0.8
    && frame.grounded
    && frame.collision_impulse <= 0
    && Math.abs(frame.yaw_rate) > 1e-9
  ))
  .map((frame) => ({
    speed: frame.speed,
    yaw_rate: frame.yaw_rate,
    steer_input: frame.steer_input,
    grounded: frame.grounded,
    collision_impulse: frame.collision_impulse,
  }));
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
  replay.meta.steering_radius_samples = steeringRadiusSamples;
  replay.meta.collision_probes = collisionProbes;
  replay.meta.landing_probes = landingProbes;
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
