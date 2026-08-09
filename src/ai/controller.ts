/** Deterministic, physics-facing decisions for AI opponents. */
import type { ItemKind, WorldInput } from '@contract/sim';
import {
  BASE_TOP_SPEED,
  TRACK_GEOMETRY,
  TRACK_HALF_WIDTH,
  TRACK_RADIUS,
} from '../physics/constants.js';

const FULL_TURN = Math.PI * 2;
const BASE_CRUISE_RATIO = 0.52;
const DIFFICULTY_CRUISE_RANGE = 0.48;
const MAX_RUBBERBAND_BONUS_RATIO = 0.10;
const RUBBERBAND_FULL_GAP = Math.PI * 0.75;
const RUBBERBAND_MIN_GAP = 0.15;
// Keep the catch-up target from collapsing faster than the fixed-tick engine
// can accelerate toward it.  The response still reaches the base target at
// zero gap, but remains strong while a real gap is closing.
const RUBBERBAND_TARGET_RESPONSE_EXPONENT = 0.33;
const TANGENT_CORRECTION_STRENGTH = 0.55;
const STEER_ERROR_RANGE = 0.35;

export interface AiKartObservation {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly trackAngle: number;
  readonly lap: number;
  readonly heldItem: ItemKind | null;
}

export interface AiDecisionContext {
  readonly self: AiKartObservation;
  readonly player: AiKartObservation;
}

export interface AiDecision {
  readonly input: WorldInput;
  readonly targetSpeed: number;
  readonly maxSpeedRatio: number;
  readonly rubberbandGap: number;
  readonly radialError: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(angle: number): number {
  const wrapped = angle % FULL_TURN;
  return wrapped < 0 ? wrapped + FULL_TURN : wrapped;
}

function wrapSignedAngle(angle: number): number {
  const wrapped = wrapAngle(angle);
  return wrapped > Math.PI ? wrapped - FULL_TURN : wrapped;
}

function trackProgress(observation: AiKartObservation): number {
  return Math.max(0, observation.lap - 1) * FULL_TURN + wrapAngle(observation.trackAngle);
}

/**
 * Produce one complete input packet through the same WorldInput path as a
 * player.  The function has no state and no time/random dependencies, so the
 * same observations always produce the same decision.
 */
export function decideAiInput(
  difficulty: number,
  context: AiDecisionContext,
): AiDecision {
  const normalizedDifficulty = clamp(difficulty, 0, 1);
  const { self, player } = context;
  const dx = self.x - TRACK_GEOMETRY.centerX;
  const dz = self.z - TRACK_GEOMETRY.centerZ;
  const radialDistance = Math.hypot(dx, dz);
  const safeDistance = radialDistance > 1e-9 ? radialDistance : TRACK_RADIUS;
  const radialX = radialDistance > 1e-9 ? dx / safeDistance : 1;
  const radialZ = radialDistance > 1e-9 ? dz / safeDistance : 0;
  const tangentX = -radialZ;
  const tangentZ = radialX;
  const radialError = radialDistance - TRACK_RADIUS;
  const radialCorrection = clamp(radialError / TRACK_HALF_WIDTH, -1, 1);
  const desiredX = tangentX - radialX * radialCorrection * TANGENT_CORRECTION_STRENGTH;
  const desiredZ = tangentZ - radialZ * radialCorrection * TANGENT_CORRECTION_STRENGTH;
  const desiredYaw = Math.atan2(desiredX, desiredZ);
  const yawError = wrapSignedAngle(desiredYaw - self.yaw);
  const steer = clamp(yawError / STEER_ERROR_RANGE, -1, 1);

  // Positive gap means the player is ahead on the same local lap.  Limit the
  // comparison to half a lap so a car that is already a lap ahead cannot
  // accidentally trigger an unbounded catch-up response.
  let progressGap = trackProgress(player) - trackProgress(self);
  while (progressGap > Math.PI) progressGap -= FULL_TURN;
  while (progressGap < -Math.PI) progressGap += FULL_TURN;
  const gap = progressGap >= RUBBERBAND_MIN_GAP ? progressGap : 0;
  const gapFactor = clamp(gap / RUBBERBAND_FULL_GAP, 0, 1);
  const maxSpeedRatio = 1 + MAX_RUBBERBAND_BONUS_RATIO * gapFactor;
  const baseTargetRatio = BASE_CRUISE_RATIO + DIFFICULTY_CRUISE_RANGE * normalizedDifficulty;
  const targetGapFactor = Math.pow(gapFactor, RUBBERBAND_TARGET_RESPONSE_EXPONENT);
  const targetRatio = baseTargetRatio + (maxSpeedRatio - baseTargetRatio) * targetGapFactor;
  const targetSpeed = BASE_TOP_SPEED * targetRatio;
  const speedError = targetSpeed - self.speed;
  const throttle = speedError > 0.2 ? clamp(speedError / 2, 0.2, 1) : 0;
  const brake = speedError < -0.4;

  return {
    input: {
      throttle,
      steer,
      brake,
      reverse: false,
      drift: false,
      jump: false,
      // AI uses the first item it gets on its next decision tick.  The
      // controller has no world mutation authority; this is only an input
      // request consumed by the shared Kart path.
      useItem: self.heldItem !== null,
    },
    targetSpeed,
    maxSpeedRatio,
    rubberbandGap: gap,
    radialError,
  };
}

export const AI_RUBBERBAND_MAX_RATIO = 1 + MAX_RUBBERBAND_BONUS_RATIO;
