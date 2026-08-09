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
const KART_BOUNDING_DIAMETER = Math.hypot(CAR_LENGTH, CAR_WIDTH);

function playerKart(snapshot) {
  const kart = snapshot.karts[snapshot.playerIndex];
  if (!kart) throw new Error(`snapshot has no player kart at index ${snapshot.playerIndex}`);
  return kart;
}

function frameFromSnapshot(snapshot) {
  const kart = playerKart(snapshot);
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
    wall_contact: kart.wallContact === true,
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
    // Landing happens before drive integration in the fixed-step order.  Cap
    // acceleration gains at 1 so the metric measures impact loss, not engine
    // thrust from the same frame as vy reaches zero.
    speed_retention: previousGroundSpeed > 0
      ? Math.min(1, currentGroundSpeed / previousGroundSpeed)
      : 0,
  };
}

function eventsBetween(previous, current) {
  const events = [];
  const tick = current.tick;
  const previousKart = playerKart(previous);
  const currentKart = playerKart(current);
  const kartKartEvents = [];
  for (let firstIndex = 0; firstIndex < current.karts.length; firstIndex += 1) {
    const first = current.karts[firstIndex];
    const previousFirst = previous.karts[firstIndex];
    if (!first || !previousFirst) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < current.karts.length; secondIndex += 1) {
      const second = current.karts[secondIndex];
      const previousSecond = previous.karts[secondIndex];
      if (!second || !previousSecond) continue;
      const distance = Math.hypot(second.pos[0] - first.pos[0], second.pos[2] - first.pos[2]);
      if (first.collisionImpulse <= 0
        || second.collisionImpulse <= 0
        || distance > KART_BOUNDING_DIAMETER + 1e-6) continue;
      kartKartEvents.push({
        tick,
        type: 'kart_kart_collision',
        data: {
          phase: previousFirst.collisionImpulse > 0 && previousSecond.collisionImpulse > 0
            ? 'contact'
            : 'impact',
          kart_a: firstIndex,
          kart_b: secondIndex,
          character_a: first.characterId,
          character_b: second.characterId,
          participants: [
            {
              kart_index: firstIndex,
              other_kart_index: secondIndex,
              impulse: first.collisionImpulse,
              other_impulse: second.collisionImpulse,
            },
            {
              kart_index: secondIndex,
              other_kart_index: firstIndex,
              impulse: second.collisionImpulse,
              other_impulse: first.collisionImpulse,
            },
          ],
          impulse_a: first.collisionImpulse,
          impulse_b: second.collisionImpulse,
          impulse_symmetry: second.collisionImpulse > 0
            ? first.collisionImpulse / second.collisionImpulse
            : 0,
          center_distance: distance,
        },
      });
    }
  }
  events.push(...kartKartEvents);
  const playerKartCollision = kartKartEvents.some((event) => (
    event.data.kart_a === current.playerIndex || event.data.kart_b === current.playerIndex
  ));
  if (previousKart.grounded && !currentKart.grounded) {
    events.push({ tick, type: 'airborne_start', data: {} });
  }
  if (!previousKart.grounded && currentKart.grounded) {
    events.push({
      tick,
      type: 'landing',
      data: {
        ...landingData(previousKart, currentKart),
        latency_ticks: current.tick - previous.tick - 1,
      },
    });
  }
  if (currentKart.collisionImpulse > 0 && !playerKartCollision) {
    events.push({
      tick,
      type: 'collision',
      data: {
        impulse: currentKart.collisionImpulse,
        phase: previousKart.collisionImpulse > 0 ? 'contact' : 'impact',
        ...collisionData(previousKart, currentKart),
      },
    });
  }
  if (previousKart.driftState === 'none' && currentKart.driftState !== 'none') {
    events.push({ tick, type: 'drift_start', data: {} });
  }
  if (currentKart.driftTier > previousKart.driftTier) {
    events.push({ tick, type: 'drift_tier_up', data: { tier: currentKart.driftTier } });
  }
  if (previousKart.driftState === 'charging' && currentKart.driftState === 'released') {
    events.push({ tick, type: 'miniturbo_release', data: { tier: previousKart.driftTier } });
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

async function replayTicks(totalTicks, inputAtTick, fixtureName, seed, options = {}) {
  const world = createWorld(options.worldOptions);
  const frames = [];
  const events = [];
  const inputTrace = options.captureInput ? [] : null;
  const aiTrace = options.captureAi ? [] : null;
  let previous = world.snapshot();
  for (let tick = 0; tick < totalTicks; tick += 1) {
    // advance() owns the world.setInput() + world.step() ordering.
    let requestedInput;
    advance(world, 1, () => {
      requestedInput = inputAtTick(tick);
      return requestedInput;
    });
    const current = world.snapshot();
    const frame = frameFromSnapshot(current);
    frames.push(frame);
    if (inputTrace) {
      inputTrace.push({
        request_tick: tick,
        frame_tick: current.tick,
        requested: { ...requestedInput },
        effective: {
          throttle: frame.throttle_input,
          steer: frame.steer_input,
        },
      });
    }
    if (aiTrace) {
      const decisions = typeof world.getAiTelemetry === 'function'
        ? world.getAiTelemetry()
        : [];
      aiTrace.push({
        tick: current.tick,
        player_pos: [...playerKart(current).pos],
        karts: current.karts.slice(1).map((kart, index) => ({
          kart_index: index + 1,
          pos: [...kart.pos],
          speed: kart.speed,
          yaw: kart.yaw,
          surface: kart.surface,
          lap: current.laps[index + 1]?.current ?? 1,
          splits: [...(current.laps[index + 1]?.splits ?? [])],
        })),
        decisions: decisions.map((decision) => ({
          kart_index: decision.kartIndex,
          difficulty: decision.difficulty,
          input: { ...decision.input },
          target_speed: decision.targetSpeed,
          max_speed_ratio: decision.maxSpeedRatio,
          rubberband_gap: decision.rubberbandGap,
          radial_error: decision.radialError,
        })),
      });
    }
    events.push(...eventsBetween(previous, current));
    previous = current;
  }
  addReleaseDurations(events, frames);
  annotateCollisionRecovery(events, frames);
  annotateLandingTelemetry(events);

  const aiLapStates = previous.karts.length > 1
    ? previous.laps.slice(1).map((lap, index) => ({
      kart_index: index + 1,
      current: lap.current,
      total: lap.total,
      best_time_s: lap.bestTime,
      splits_s: [...lap.splits],
    }))
    : null;

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
      kart_count: previous.karts.length,
      player_index: previous.playerIndex,
      collision_recovery_definition: 'first two consecutive grounded, collision-free frames above 50% pre-impact ground speed with yaw-rate error <= max(0.05, 25% expected)',
      wall_stick_definition: 'consecutive direct wall-contact frames with ground speed below 10% of asphalt BASE_TOP_SPEED; independent of new collision impulses',
      kart_kart_collision_coverage: 'available: kart_kart_collision events include both participants and impulses',
      landing_angle_definition: 'angle between pre-landing ground velocity and downward vertical; >=45° smooth, <45° steep',
      landing_speed_retention_definition: 'post/pre ground speed, capped at 1 to exclude same-tick drive acceleration from landing impact loss',
      surface_definition: 'R13 uses two short angular sectors inside the existing annular lane; surface probes report raw target frames and a settled asphalt reference sweep',
      ...(aiLapStates ? { ai_lap_states: aiLapStates } : {}),
    },
    frames,
    events,
    ...(inputTrace ? { input_trace: inputTrace } : {}),
    ...(aiTrace ? { ai_trace: aiTrace } : {}),
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

const WALL_ESCAPE_DRIVE_TICKS = 260;
const WALL_ESCAPE_REST_SPEED = 0.01;
const WALL_ESCAPE_MAX_TICKS = 700;

function signedAngleDelta(from, to) {
  const raw = to - from;
  return Math.atan2(Math.sin(raw), Math.cos(raw));
}

async function wallEscapeProbe(name, action) {
  const world = createWorld({ playerStartAngle: 0 });
  const frames = [];
  const baseInput = {
    throttle: 0,
    steer: 0,
    brake: false,
    reverse: false,
    drift: false,
    jump: false,
  };
  let impactTick = null;
  let restTick = null;
  let restFrame = null;
  let firstMotion = null;
  for (let tick = 1; tick <= WALL_ESCAPE_MAX_TICKS; tick += 1) {
    const requestedInput = tick <= WALL_ESCAPE_DRIVE_TICKS
      ? { ...baseInput, throttle: 1, steer: -0.2 }
      : restTick === null
        ? { ...baseInput, brake: true, steer: -0.5 }
        : { ...baseInput, ...action };
    advance(world, 1, () => requestedInput);
    const frame = frameFromSnapshot(world.snapshot());
    frames.push(frame);
    if (impactTick === null && frame.collision_impulse > 0) impactTick = tick;
    if (
      restTick === null
      && impactTick !== null
      && frame.wall_contact
      && groundSpeed(frame) < WALL_ESCAPE_REST_SPEED
      && frame.collision_impulse <= 0
    ) {
      restTick = tick;
      restFrame = frame;
    }
    if (restTick !== null && tick > restTick && firstMotion === null) {
      const positionDelta = Math.hypot(
        frame.pos[0] - restFrame.pos[0],
        frame.pos[2] - restFrame.pos[2],
      );
      const yawDelta = Math.abs(signedAngleDelta(restFrame.yaw, frame.yaw));
      const movedByDrive = groundSpeed(frame) > WALL_ESCAPE_REST_SPEED;
      const turnedBySteer = yawDelta > 1e-4;
      if ((name === 'reverse' && movedByDrive) || (name === 'steer' && turnedBySteer)) {
        firstMotion = {
          tick,
          frames_after_rest: tick - restTick,
          speed: groundSpeed(frame),
          position_delta: positionDelta,
          yaw_delta: yawDelta,
          yaw_rate: frame.yaw_rate,
          wall_contact: frame.wall_contact,
          collision_impulse: frame.collision_impulse,
          input: { ...action },
        };
      }
    }
  }
  if (impactTick === null || restTick === null || firstMotion === null || !restFrame) {
    throw new Error(`wall escape probe did not complete: ${name}`);
  }
  return {
    name,
    setup: {
      player_start_angle: 0,
      drive_ticks: WALL_ESCAPE_DRIVE_TICKS,
      drive_input: { ...baseInput, throttle: 1, steer: -0.2 },
      settle_input: { ...baseInput, brake: true, steer: -0.5 },
      rest_definition: `direct wall_contact with ground speed < ${WALL_ESCAPE_REST_SPEED} and collision_impulse <= 0`,
    },
    collision_tick: impactTick,
    rest_tick: restTick,
    frames_from_collision_to_rest: restTick - impactTick,
    rest_frame: {
      tick: restFrame.tick,
      pos: [...restFrame.pos],
      speed: groundSpeed(restFrame),
      yaw: restFrame.yaw,
      yaw_rate: restFrame.yaw_rate,
      wall_contact: restFrame.wall_contact,
      collision_impulse: restFrame.collision_impulse,
    },
    first_motion: firstMotion,
    result: 'PASS',
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

async function surfaceProbe(name, surface, ticks = 2400) {
  const replay = await replayTicks(
    ticks,
    () => ({
      throttle: 1,
      steer: -0.3,
      brake: false,
      reverse: false,
      drift: false,
      jump: false,
    }),
    `surface-${name}`,
    `${fixture.seed}-surface-${name}`,
  );
  const warmupTick = 300;
  const samples = replay.frames
    .filter((frame) => (
      frame.tick > warmupTick
      && frame.surface === surface
      && frame.collision_impulse <= 0
    ))
    .map((frame) => ({
      tick: frame.tick,
      surface: frame.surface,
      speed: frame.speed,
      collision_impulse: frame.collision_impulse,
    }));
  const asphaltReferenceSpeeds = replay.frames
    .filter((frame) => (
      frame.tick > warmupTick
      && frame.surface === 'asphalt'
      && frame.collision_impulse <= 0
      && frame.speed >= BASE_TOP_SPEED * 0.8
    ))
    .map((frame) => frame.speed);
  if (samples.length < 30 || asphaltReferenceSpeeds.length < 30) {
    throw new Error(`surface probe ${name} did not collect enough settled samples`);
  }
  return {
    name,
    surface,
    steer: -0.3,
    warmup_tick: warmupTick,
    samples,
    asphalt_reference_speeds: asphaltReferenceSpeeds,
    definition: 'mean settled target-surface speed divided by mean collision-free asphalt speed >=80% BASE_TOP_SPEED in the same deterministic steering sweep',
  };
}

async function inputLatencyProbe() {
  const requestTick = 24;
  const replay = await replayTicks(
    60,
    (tick) => ({
      throttle: 1,
      steer: tick >= requestTick ? 0.37 : 0,
      brake: false,
      reverse: false,
      drift: false,
      jump: false,
    }),
    'input-latency',
    `${fixture.seed}-input-latency`,
    { captureInput: true },
  );
  const sample = replay.input_trace.find(
    (entry) => entry.request_tick === requestTick && entry.effective.steer === 0.37,
  );
  if (!sample) throw new Error('input latency probe did not observe the requested steer on the next simulation frame');
  return {
    request_tick: sample.request_tick,
    applied_tick: sample.frame_tick,
    requested_steer: sample.requested.steer,
    effective_steer: sample.effective.steer,
    latency_ticks: sample.frame_tick - (sample.request_tick + 1),
  };
}

async function inputBufferProbe() {
  const held = await replayTicks(
    180,
    () => ({
      throttle: 1,
      steer: 0.3,
      brake: false,
      reverse: false,
      drift: true,
      jump: false,
    }),
    'input-buffer-held-reference',
    `${fixture.seed}-input-buffer-held-reference`,
  );
  const heldActivation = held.events.find((event) => event.type === 'drift_start');
  if (!heldActivation) {
    return {
      press_tick: null,
      release_tick: null,
      activation_tick: null,
      held_reference_activation_tick: null,
      measured_lead_ticks: 0,
      pulse_reached_reference_window: false,
    };
  }

  // Sweep early tap positions around the held reference.  The latest
  // successful release is the observed buffer edge, not a hard-coded event.
  const candidates = Array.from({ length: 24 }, (_, index) => index + 1);
  const pulses = await Promise.all(candidates.map(async (leadTicks) => {
    const pressTick = Math.max(1, heldActivation.tick - leadTicks);
    const releaseTick = pressTick + 1;
    const pulse = await replayTicks(
      180,
      (tick) => ({
        throttle: 1,
        steer: 0.3,
        brake: false,
        reverse: false,
        drift: tick === pressTick,
        jump: false,
      }),
      `input-buffer-pulse-${leadTicks}`,
      `${fixture.seed}-input-buffer-pulse-${leadTicks}`,
    );
    const activation = pulse.events.find((event) => event.type === 'drift_start');
    return { leadTicks, pressTick, releaseTick, activation };
  }));
  const successful = pulses.filter((probe) => probe.activation);
  const latest = successful.at(-1);
  return {
    press_tick: latest?.pressTick ?? null,
    release_tick: latest?.releaseTick ?? null,
    activation_tick: latest?.activation?.tick ?? null,
    held_reference_activation_tick: heldActivation?.tick ?? null,
    measured_lead_ticks: latest?.leadTicks ?? 0,
    pulse_reached_reference_window: latest?.activation !== undefined,
  };
}

async function inputCommandSweep(name, field, values) {
  const replay = await replayTicks(
    values.length,
    (tick) => ({
      throttle: field === 'throttle' ? values[tick] : 0,
      steer: field === 'steer' ? values[tick] : 0,
      brake: false,
      reverse: false,
      drift: false,
      jump: false,
    }),
    `input-${name}`,
    `${fixture.seed}-input-${name}`,
    { captureInput: true },
  );
  return {
    name,
    field,
    samples: replay.input_trace,
  };
}

async function kartKartProbe() {
  const replay = await replayTicks(
    600,
    () => ({
      throttle: 1,
      steer: 0,
      brake: false,
      reverse: false,
      drift: false,
      jump: false,
    }),
    'kart-kart-symmetry',
    `${fixture.seed}-kart-kart-symmetry`,
    {
      worldOptions: {
        aiOpponents: [{ characterId: 'duoduo', difficulty: 0 }],
      },
    },
  );
  const events = replay.events.filter((event) => event.type === 'kart_kart_collision');
  if (events.length === 0) throw new Error('kart-kart probe did not produce a collision');
  return {
    name: 'kart-kart-symmetry',
    kart_count: replay.meta.kart_count,
    player_index: replay.meta.player_index,
    events,
  };
}

function trackAngleFromPosition(position) {
  return Math.atan2(
    position[2] - TRACK_GEOMETRY.centerZ,
    position[0] - TRACK_GEOMETRY.centerX,
  );
}

function signedTrackGap(playerPosition, aiPosition) {
  let gap = trackAngleFromPosition(playerPosition) - trackAngleFromPosition(aiPosition);
  while (gap > Math.PI) gap -= Math.PI * 2;
  while (gap < -Math.PI) gap += Math.PI * 2;
  return gap;
}

function aiProbeInput(throttle, steer = 0) {
  return {
    throttle,
    steer,
    brake: false,
    reverse: false,
    drift: false,
    jump: false,
  };
}

const AI_TRACE_SAMPLE_INTERVAL_TICKS = 10;

function sampledAiTrace(trace) {
  return trace.filter((_, index) => (
    index % AI_TRACE_SAMPLE_INTERVAL_TICKS === 0
    || index === trace.length - 1
  ));
}

async function deterministicAiProbe(name, factory) {
  const [first, second] = await Promise.all([factory(), factory()]);
  const firstSerialized = JSON.stringify(first);
  if (firstSerialized !== JSON.stringify(second)) {
    throw new Error(`AI probe ${name} is not byte-identical across two runs`);
  }
  return { ...first, name, deterministic_byte_identical: true };
}

async function aiLapCompletionProbe() {
  const replay = await replayTicks(
    2400,
    () => ({ throttle: 0, steer: 0, brake: true, reverse: false, drift: false, jump: false }),
    'ai-lap-completion',
    `${fixture.seed}-ai-lap-completion`,
    {
      captureAi: true,
      worldOptions: {
        aiOpponents: [{ characterId: 'duoduo', difficulty: 1 }],
      },
    },
  );
  const state = replay.meta.ai_lap_states?.[0];
  return {
    ai_lap_completion: Boolean(state && state.splits_s.length >= 1),
    ai_lap_time_s: state?.splits_s?.[0] ?? null,
    trace_sample_interval_ticks: AI_TRACE_SAMPLE_INTERVAL_TICKS,
    trace: sampledAiTrace(replay.ai_trace),
  };
}

async function difficultyLapSpreadProbe() {
  const run = async (difficulty) => replayTicks(
    3000,
    () => ({ throttle: 0, steer: 0, brake: true, reverse: false, drift: false, jump: false }),
    `ai-difficulty-${difficulty}`,
    `${fixture.seed}-ai-difficulty-${difficulty}`,
    {
      captureAi: true,
      worldOptions: {
        aiStartAngles: [0.6],
        aiOpponents: [{ characterId: 'duoduo', difficulty }],
      },
    },
  );
  const [easy, hard] = await Promise.all([run(0), run(1)]);
  const easyLap = easy.meta.ai_lap_states?.[0]?.splits_s?.[0] ?? null;
  const hardLap = hard.meta.ai_lap_states?.[0]?.splits_s?.[0] ?? null;
  return {
    difficulty_0_lap_time_s: easyLap,
    difficulty_1_lap_time_s: hardLap,
    spread_s: easyLap !== null && hardLap !== null ? easyLap - hardLap : null,
    trace_sample_interval_ticks: AI_TRACE_SAMPLE_INTERVAL_TICKS,
    traces: {
      difficulty_0: sampledAiTrace(easy.ai_trace),
      difficulty_1: sampledAiTrace(hard.ai_trace),
    },
  };
}

async function overtakeProbe() {
  const replay = await replayTicks(
    2400,
    () => aiProbeInput(0.05, -0.3),
    'ai-overtake',
    `${fixture.seed}-ai-overtake`,
    {
      captureAi: true,
      worldOptions: {
        playerStartAngle: 1.0,
        aiStartAngles: [0],
        aiOpponents: [{ characterId: 'duoduo', difficulty: 1 }],
      },
    },
  );
  let previousGap = null;
  let overtakeTick = null;
  for (let index = 0; index < replay.ai_trace.length; index += 1) {
    const trace = replay.ai_trace[index];
    const aiKart = trace.karts[0];
    if (!aiKart || !trace.player_pos) continue;
    const gap = signedTrackGap(trace.player_pos, aiKart.pos);
    if (previousGap !== null && previousGap > 0 && gap <= 0) {
      overtakeTick = trace.tick;
      break;
    }
    previousGap = gap;
  }
  return {
    overtake_time_s: overtakeTick === null ? null : overtakeTick / TICK_HZ,
    overtake_tick: overtakeTick,
    trace_sample_interval_ticks: AI_TRACE_SAMPLE_INTERVAL_TICKS,
    trace: sampledAiTrace(replay.ai_trace),
  };
}

async function rubberbandProbe() {
  const replay = await replayTicks(
    2400,
    () => aiProbeInput(0.28, -0.3),
    'ai-rubberband',
    `${fixture.seed}-ai-rubberband`,
    {
      captureAi: true,
      worldOptions: {
        playerStartAngle: 2.5,
        aiStartAngles: [0],
        aiOpponents: [{ characterId: 'duoduo', difficulty: 0.5 }],
      },
    },
  );
  const samples = replay.ai_trace.flatMap((trace) => trace.karts);
  const decisions = replay.ai_trace.flatMap((trace) => trace.decisions);
  const observedMaxSpeed = Math.max(...samples.map((sample) => sample.speed), 0);
  const configuredMaxRatio = Math.max(...decisions.map((decision) => decision.max_speed_ratio), 1);
  const activeGaps = decisions
    .map((decision) => decision.rubberband_gap)
    .filter((gap) => gap > 0);
  return {
    observed_max_speed_ratio: observedMaxSpeed / BASE_TOP_SPEED,
    configured_max_speed_ratio: configuredMaxRatio,
    max_rubberband_gap: Math.max(...activeGaps, 0),
    trace_sample_interval_ticks: AI_TRACE_SAMPLE_INTERVAL_TICKS,
    trace: sampledAiTrace(replay.ai_trace),
  };
}

const DRIFT_COVERAGE_ACCELERATION_TICKS = 120;
const DRIFT_COVERAGE_HOLD_TICKS = Object.freeze({ 1: 110, 3: 432 });

function driftCoverageInput(releaseTick, drift, tick, steer) {
  if (tick < DRIFT_COVERAGE_ACCELERATION_TICKS) {
    return {
      throttle: 1,
      steer: 0,
      brake: false,
      reverse: false,
      drift: false,
      jump: false,
    };
  }
  return {
    throttle: 1,
    steer,
    brake: false,
    reverse: false,
    drift: drift && tick < releaseTick,
    jump: false,
  };
}

function distance2d(from, to) {
  return Math.hypot(to.pos[0] - from.pos[0], to.pos[2] - from.pos[2]);
}

function meanValues(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function driftCoverageProbe(tier) {
  const holdTicks = DRIFT_COVERAGE_HOLD_TICKS[tier];
  const releaseTick = DRIFT_COVERAGE_ACCELERATION_TICKS + holdTicks;
  const totalTicks = releaseTick + 2 * TICK_HZ + 1;
  const steer = tier === 3 ? 0.2 : -0.2;
  const worldOptions = tier === 3 ? { playerStartAngle: Math.PI / 2 } : undefined;
  const [drift, straight] = await Promise.all([
    replayTicks(
      totalTicks,
      (tick) => driftCoverageInput(releaseTick, true, tick, steer),
      `drift-tier-${tier}`,
      `${fixture.seed}-drift-tier-${tier}`,
      { worldOptions },
    ),
    replayTicks(
      totalTicks,
      (tick) => driftCoverageInput(releaseTick, false, tick, steer),
      `drift-tier-${tier}-baseline`,
      `${fixture.seed}-drift-tier-${tier}-baseline`,
      { worldOptions },
    ),
  ]);
  const releaseEvent = drift.events.find((event) => (
    event.type === 'miniturbo_release' && event.data?.tier === tier
  ));
  if (!releaseEvent) {
    throw new Error(`drift tier-${tier} probe did not release the requested tier`);
  }
  const driftReleaseFrame = drift.frames.find((frame) => frame.tick === releaseEvent.tick);
  const driftAfterFrame = drift.frames.find((frame) => frame.tick === releaseEvent.tick + 2 * TICK_HZ);
  const straightReleaseFrame = straight.frames.find((frame) => frame.tick === releaseEvent.tick);
  const straightAfterFrame = straight.frames.find((frame) => frame.tick === releaseEvent.tick + 2 * TICK_HZ);
  if (!driftReleaseFrame || !driftAfterFrame || !straightReleaseFrame || !straightAfterFrame) {
    throw new Error(`drift tier-${tier} probe is too short for the two-second baseline`);
  }
  const driftDistance = distance2d(driftReleaseFrame, driftAfterFrame);
  const straightDistance = distance2d(straightReleaseFrame, straightAfterFrame);
  const tierUp = drift.events.find((event) => (
    event.type === 'drift_tier_up' && event.data?.tier === tier
  ));
  const driftStartTick = drift.events.find((event) => event.type === 'drift_start')?.tick ?? null;
  return {
    name: `drift-tier-${tier}`,
    tier,
    drift_start_tick: driftStartTick,
    tier_up_tick: tierUp?.tick ?? null,
    charge_time_s: driftStartTick !== null && tierUp
      ? (tierUp.tick - driftStartTick) / TICK_HZ
      : null,
    release_tick: releaseEvent.tick,
    drift_distance: driftDistance,
    straight_distance: straightDistance,
    car_lengths_gained: (driftDistance - straightDistance) / CAR_LENGTH,
    deterministic_byte_identical: JSON.stringify(drift) === JSON.stringify(
      await replayTicks(
        totalTicks,
        (tick) => driftCoverageInput(releaseTick, true, tick, steer),
        `drift-tier-${tier}`,
        `${fixture.seed}-drift-tier-${tier}`,
        { worldOptions },
      ),
    ),
  };
}

const driftReplays = await Promise.all([replayOnce(), replayOnce(), replayOnce()]);
const baseline = await replayOnce((input) => ({ ...input, drift: false }));
const driftCoverageProbes = await Promise.all([
  driftCoverageProbe(1),
  driftCoverageProbe(3),
]);
const collisionProbes = await Promise.all([
  collisionProbe('wall-30deg', -0.95),
  collisionProbe('wall-head-on', 1),
]);
const wallEscapeProbes = await Promise.all([
  wallEscapeProbe('reverse', { reverse: true }),
  wallEscapeProbe('steer', { steer: -1 }),
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
const surfaceProbes = await Promise.all([
  surfaceProbe('grass', 'grass'),
  surfaceProbe('dirt', 'dirt'),
]);
const inputFeedback = {
  definition: {
    latency: 'simulation frame tick minus request tick minus one; setInput and step occur in the same advance tick',
    buffer: 'latest successful early drift release before the held reference activation; measured from release tick to buffered drift_start',
    deadzone: 'largest absolute requested command whose effective snapshot input remains zero, measured from the command sweep',
  },
  latency_probe: await inputLatencyProbe(),
  buffer_probe: await inputBufferProbe(),
  deadzone_probes: await Promise.all([
    inputCommandSweep('throttle-deadzone', 'throttle', Array.from({ length: 101 }, (_, index) => index / 100)),
    inputCommandSweep('steer-deadzone', 'steer', Array.from({ length: 201 }, (_, index) => index / 100 - 1)),
  ]),
};
const kartKartProbes = [await kartKartProbe()];
const aiProbes = await Promise.all([
  deterministicAiProbe('ai-lap-completion', aiLapCompletionProbe),
  deterministicAiProbe('ai-overtake', overtakeProbe),
  deterministicAiProbe('ai-difficulty-spread', difficultyLapSpreadProbe),
  deterministicAiProbe('ai-rubberband', rubberbandProbe),
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
for (const probe of driftCoverageProbes) {
  baselines[String(probe.tier)] = {
    release_tick: probe.release_tick,
    drift_distance: probe.drift_distance,
    straight_distance: probe.straight_distance,
    car_lengths_gained: probe.car_lengths_gained,
  };
}
const activeDriftFrames = driftReplays[0].frames.filter((frame) => frame.drift_state !== 'none');
if (activeDriftFrames.length === 0) throw new Error('fixture did not produce drift frames');
const driftStartTick = activeDriftFrames[0].tick;
const driftEndTick = activeDriftFrames.at(-1).tick;
const baselineWindowFrames = baseline.frames.filter(
  (frame) => frame.tick >= driftStartTick && frame.tick <= driftEndTick,
);
const driftSpeedMean = meanValues(activeDriftFrames.map((frame) => frame.speed));
const baselineSpeedMean = meanValues(baselineWindowFrames.map((frame) => frame.speed));
if (baselineSpeedMean <= 0) throw new Error('baseline drift window has no speed');
const driftSpeedRetention = driftSpeedMean / baselineSpeedMean;
for (const replay of driftReplays) {
  replay.meta.baselines = baselines;
  replay.meta.drift_coverage_probes = driftCoverageProbes;
  replay.meta.drift_speed_retention = driftSpeedRetention;
  replay.meta.steering_radius_samples = steeringRadiusSamples;
  replay.meta.collision_probes = collisionProbes;
  replay.meta.wall_escape_probes = wallEscapeProbes;
  replay.meta.landing_probes = landingProbes;
  replay.meta.surface_probes = surfaceProbes;
  replay.meta.input_feedback = inputFeedback;
  replay.meta.kart_kart_probes = kartKartProbes;
  replay.meta.ai_probes = aiProbes;
  replay.meta.ai_definition = 'AI decisions are pure per-tick track-line/speed control; all movement is applied through Kart.setInput() and shared drive/yaw integration. Probe traces include raw AI speed and decision caps.';
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
