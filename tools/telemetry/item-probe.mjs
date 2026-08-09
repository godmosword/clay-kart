#!/usr/bin/env node

/** Deterministic item-box probe used by the R36 handoff artifact. */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSha, loadSimulation } from './runtime.mjs';

const outputPath = resolve(process.argv[2] ?? 'loop/round-36/artifacts/item-probe.json');
const seed = process.argv[3] ?? 20260730;
const { createWorld, advance, TICK_DT, TICK_HZ } = await loadSimulation();

function angleFromPosition(position, centerZ = 30) {
  return Math.atan2(position[2] - centerZ, position[0]);
}

function player(snapshot) {
  return snapshot.karts[snapshot.playerIndex];
}

function ai(snapshot) {
  return snapshot.karts.find((_, index) => index !== snapshot.playerIndex);
}

function tick(world, input) {
  advance(world, 1, () => input);
  return world.snapshot();
}

async function collect() {
  const initialWorld = createWorld({ seed });
  const initial = initialWorld.snapshot();
  const boxes = initial.itemBoxes;
  const assignments = [];

  for (let boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
    const angle = angleFromPosition(boxes[boxIndex].position);
    const world = createWorld({ seed, playerStartAngle: angle });
    let snapshot = tick(world, { throttle: 0, brake: true });
    const pickup = snapshot.events.find((event) => event.type === 'item_pickup');
    if (!pickup || pickup.kartIndex !== snapshot.playerIndex) {
      throw new Error(`box ${boxIndex} did not produce a player pickup`);
    }

    const heldBeforeUse = player(snapshot).heldItem;
    const speedBeforeUse = player(snapshot).speed;
    snapshot = tick(world, { throttle: 0, brake: true, useItem: true });
    const use = snapshot.events.find((event) => event.type === 'item_use');
    if (!use || use.kartIndex !== snapshot.playerIndex) {
      throw new Error(`box ${boxIndex} did not produce a player item use`);
    }

    const effectSamples = [];
    for (let sample = 0; sample < 45; sample += 1) {
      snapshot = tick(world, { throttle: 1, brake: false });
      effectSamples.push({
        tick: snapshot.tick,
        speed: player(snapshot).speed,
        held_item: player(snapshot).heldItem,
        item_effect: player(snapshot).itemEffect,
        surface: player(snapshot).surface,
      });
    }

    // The box may have been left behind while measuring the effect. Observe
    // its state directly so the cooldown proof does not depend on a second
    // pickup happening at the exact same position.
    const respawnWorld = createWorld({ seed, playerStartAngle: angle });
    let respawnSnapshot = tick(respawnWorld, { throttle: 0, brake: true });
    if (!respawnSnapshot.events.some((event) => event.type === 'item_pickup')) {
      throw new Error(`box ${boxIndex} respawn setup did not pick up`);
    }
    respawnSnapshot = tick(respawnWorld, { throttle: 0, brake: true, useItem: true });
    let respawnPickup = null;
    for (let wait = 0; wait < 380 && respawnPickup === null; wait += 1) {
      respawnSnapshot = tick(respawnWorld, { throttle: 0, brake: true });
      respawnPickup = respawnSnapshot.events.find((event) => (
        event.type === 'item_pickup' && event.boxId === pickup.boxId
      )) ?? null;
    }
    if (respawnPickup === null) throw new Error(`box ${boxIndex} did not respawn within 380 ticks`);

    assignments.push({
      box_index: boxIndex,
      box_id: pickup.boxId,
      item: pickup.item,
      pickup_tick: pickup.tick,
      held_before_use: heldBeforeUse,
      speed_before_use: speedBeforeUse,
      use: {
        item: use.item,
        effect: use.effect,
        target_kart_indices: [...use.targetKartIndices],
      },
      speed_peak_after_use: Math.max(...effectSamples.map((sample) => sample.speed)),
      effect_samples: effectSamples.slice(0, 5).concat(effectSamples.slice(-2)),
      respawn: {
        pickup_tick: respawnPickup.tick,
        cooldown_ticks: respawnPickup.tick - pickup.tick,
      },
    });
  }

  const shockwaveAssignment = assignments.find((assignment) => assignment.item === 'shockwave');
  if (!shockwaveAssignment) throw new Error('seed did not allocate a shockwave item');
  const shockwaveBox = boxes[shockwaveAssignment.box_index];
  const shockwaveAngle = angleFromPosition(shockwaveBox.position);
  const shockwaveWorld = createWorld({
    seed,
    playerStartAngle: shockwaveAngle,
    aiStartAngles: [shockwaveAngle],
    aiOpponents: [{ characterId: 'duoduo', difficulty: 1 }],
  });
  let shockwaveSnapshot = tick(shockwaveWorld, { throttle: 0, brake: true });
  if (!shockwaveSnapshot.events.some((event) => event.type === 'item_pickup' && event.kartIndex === 0)) {
    throw new Error('shockwave player did not pick up its item');
  }
  for (let wait = 0; wait < 60; wait += 1) {
    shockwaveSnapshot = tick(shockwaveWorld, { throttle: 0, brake: true });
  }
  const targetBefore = ai(shockwaveSnapshot)?.speed ?? 0;
  shockwaveSnapshot = tick(shockwaveWorld, { throttle: 0, brake: true, useItem: true });
  const shockwaveUse = shockwaveSnapshot.events.find((event) => event.type === 'item_use');
  const targetAfter = ai(shockwaveSnapshot)?.speed ?? 0;
  if (!shockwaveUse || shockwaveUse.item !== 'shockwave' || shockwaveUse.targetKartIndices.length < 1) {
    throw new Error('shockwave did not target an opponent');
  }

  const aiAngle = shockwaveAngle - Math.hypot(1.2, 0.7) * 2 / 30;
  const aiWorld = createWorld({
    seed,
    playerStartAngle: shockwaveAngle + Math.PI,
    aiStartAngles: [aiAngle],
    aiOpponents: [{ characterId: 'xiaohong', difficulty: 0.5 }],
  });
  let aiSnapshot = tick(aiWorld, { throttle: 0, brake: true });
  const aiPickup = aiSnapshot.events.find((event) => event.type === 'item_pickup' && event.kartIndex === 1);
  if (!aiPickup) throw new Error('AI did not pick up an item');
  let aiUse = null;
  for (let wait = 0; wait < 10 && aiUse === null; wait += 1) {
    aiSnapshot = tick(aiWorld, { throttle: 0, brake: true });
    aiUse = aiSnapshot.events.find((event) => event.type === 'item_use' && event.kartIndex === 1) ?? null;
  }
  if (!aiUse) throw new Error('AI did not use its picked-up item');

  return {
    meta: {
      fixture: 'r36-item-probe',
      seed,
      tick_hz: TICK_HZ,
      tick_dt_s: TICK_DT,
      build_sha: buildSha(),
      deterministic_item_assignment: 'seed phase plus alternating box/respawn deck; no Math.random',
    },
    boxes: assignments,
    shockwave_effect: {
      item: shockwaveUse.item,
      source_kart_index: shockwaveUse.kartIndex,
      target_kart_indices: [...shockwaveUse.targetKartIndices],
      target_speed_before: targetBefore,
      target_speed_after: targetAfter,
      target_speed_ratio: targetBefore > 0 ? targetAfter / targetBefore : null,
    },
    ai_usage: {
      picked_item: aiPickup.item,
      use_tick: aiUse.tick,
      use_item: aiUse.item,
      kart_index: aiUse.kartIndex,
    },
  };
}

const [first, second] = await Promise.all([collect(), collect()]);
const firstJson = JSON.stringify(first);
const secondJson = JSON.stringify(second);
if (firstJson !== secondJson) throw new Error('item probe is not byte-identical across two runs');

await writeFile(outputPath, `${JSON.stringify({ ...first, deterministic_byte_identical: true }, null, 2)}\n`, 'utf8');
console.log(`item-probe: PASS (${outputPath})`);
