/**
 * Deterministic W1 kart simulation.
 *
 * This module deliberately contains no rendering or browser dependencies.  The
 * track is an annular collider.  Each kart is integrated freely in world space;
 * steering is the only source of yaw, so a released steering input really does
 * settle to zero.  AI opponents use a deterministic stationary placeholder in
 * this architecture phase; driving decisions are deliberately out of scope.
 */
import type {
  CharacterId,
  KartState,
  LapState,
  SimSnapshot,
  SimWorld,
  WorldOptions,
} from '@contract/sim';
import {
  BASE_TOP_SPEED,
  CAR_LENGTH,
  CAR_WIDTH,
  TRACK_CENTER_Z,
  TRACK_GEOMETRY,
  TRACK_HALF_WIDTH,
  TRACK_RADIUS,
} from './constants.js';

const TOTAL_LAPS = 3;
const REVERSE_TOP_SPEED = BASE_TOP_SPEED * 0.4;
const ENGINE_ACCELERATION = 16.5;
const COAST_DECELERATION = 5.2;
const BRAKE_DECELERATION = 24;
const GRAVITY = 30;
const JUMP_SPEED = 10;
const KART_BOUNDING_RADIUS = Math.hypot(CAR_LENGTH / 2, CAR_WIDTH / 2);
const INNER_COLLISION_RADIUS = TRACK_RADIUS - TRACK_HALF_WIDTH + KART_BOUNDING_RADIUS;
const OUTER_COLLISION_RADIUS = TRACK_RADIUS + TRACK_HALF_WIDTH - KART_BOUNDING_RADIUS;
const MAX_STEER_YAW_RATE = 2.7;
const AIR_CONTROL_RATIO = 0.3;
const STEER_RISE_TIME_CONSTANT = 0.03;
const STEER_RELEASE_TIME_CONSTANT = 0.07;
const LATERAL_GRIP = 14;
const WALL_BOUNCE = 0.07;
const WALL_DEFAULT_BOUNCE = 0.15;
const WALL_GRAZING_BOUNCE = 0.35;
const WALL_HEAD_ON_ANGLE_DEG = 15;
const WALL_GRAZING_ANGLE_DEG = 30;
const KART_BOUNCE = 0.2;
const LANDING_SMOOTH_ANGLE_DEG = 45;
const LANDING_HARD_RETENTION = 0.7;
const LANDING_MIN_HORIZONTAL_SPEED = 0.1;
// Surface sectors live inside the existing annular lane and do not alter either
// collision boundary.  They are deliberately placed on the lower half of the
// lap so the gameplay fixture's short upper-half route remains asphalt.
const SURFACE_DIRT_START_ANGLE = Math.PI * 1.34;
const SURFACE_DIRT_END_ANGLE = Math.PI * 1.44;
const SURFACE_GRASS_START_ANGLE = Math.PI * 1.54;
const SURFACE_GRASS_END_ANGLE = Math.PI * 1.64;
const DIRT_SPEED_FACTOR = 0.85;
const GRASS_SPEED_FACTOR = 0.62;
const DRIFT_ENTRY_SPEED = 10.5;
const DRIFT_INPUT_BUFFER_SECONDS = 0.1;
const DRIFT_INPUT_BUFFER_TICKS = Math.round(DRIFT_INPUT_BUFFER_SECONDS * 120);
const STEER_DEADZONE = 0.08;
const DRIFT_TIER1_TIME = 0.85;
const DRIFT_TIER2_TIME = 2.0;
const DRIFT_TIER3_TIME = 3.5;
const DRIFT_YAW_RATE_RATIO = 1.4;
const MINI_TURBO_DURATION = 1.05;
const MINI_TURBO_GAIN_BY_TIER = [0, 0.85, 2.5, 3.4] as const;
const START_LINE_LEAVE_ANGLE = 0.25;
const START_LINE_RETURN_ANGLE = Math.PI * 1.75;
const START_LINE_CROSS_ANGLE = Math.PI * 0.25;

export interface WorldInput {
  /** Normalised accelerator input.  Omitted fields retain their previous value. */
  throttle?: number;
  /** Steering input: -1 to 1. */
  steer?: number;
  /** Applies strong deceleration while held. */
  brake?: boolean;
  /** Reverses the drive direction while throttle is held. */
  reverse?: boolean;
  /** Enters/maintains drift while held; release triggers mini-turbo. */
  drift?: boolean;
  /** One-shot jump request; W1 has no jump button in the loader yet. */
  jump?: boolean;
}

export interface PhysicsWorld extends SimWorld {
  setInput(input: WorldInput): void;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function moveTowardZero(value: number, amount: number): number {
  if (Math.abs(value) <= amount) return 0;
  return value - Math.sign(value) * amount;
}

function landingHorizontalRetention(horizontalSpeed: number, descentSpeed: number): number {
  if (horizontalSpeed < LANDING_MIN_HORIZONTAL_SPEED) return 1;
  const landingAngleDeg = Math.atan2(horizontalSpeed, descentSpeed) * 180 / Math.PI;
  const smoothBlend = clamp(landingAngleDeg / LANDING_SMOOTH_ANGLE_DEG, 0, 1);
  return LANDING_HARD_RETENTION
    + (1 - LANDING_HARD_RETENTION) * smoothBlend * smoothBlend;
}

function surfaceAtPosition(angle: number): KartState['surface'] {
  const wrappedAngle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (wrappedAngle >= SURFACE_DIRT_START_ANGLE && wrappedAngle <= SURFACE_DIRT_END_ANGLE) return 'dirt';
  if (wrappedAngle >= SURFACE_GRASS_START_ANGLE && wrappedAngle <= SURFACE_GRASS_END_ANGLE) return 'grass';
  return 'asphalt';
}

function surfaceSpeedFactor(surface: KartState['surface']): number {
  if (surface === 'grass') return GRASS_SPEED_FACTOR;
  if (surface === 'dirt') return DIRT_SPEED_FACTOR;
  return 1;
}

function wrapAngle(angle: number): number {
  const wrapped = angle % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}

class Kart {
  readonly characterId: CharacterId;
  #x: number;
  #y = 0;
  #z: number;
  #vx = 0;
  #vy = 0;
  #vz = 0;
  #yaw = 0;
  #yawRate = 0;
  #grounded = true;
  #collisionImpulse = 0;
  #surface: KartState['surface'] = 'asphalt';

  #throttle = 1;
  #steer = 0;
  #brake = false;
  #reverse = false;
  #driftHeld = false;
  #driftBufferPending = false;
  #driftBufferExpiryTick = -1;
  #driftBufferedActivation = false;
  #steerCommand = 0;
  #jumpHeld = false;
  #jumpQueued = false;

  #driftState: KartState['driftState'] = 'none';
  #driftCharge = 0;
  #driftTier: KartState['driftTier'] = 0;
  #driftTime = 0;
  #releaseTimer = 0;
  #boostSpeed = 0;

  #trackAngle = 0;
  #hasLeftStartLine = false;
  #currentLap = 1;
  #lapStartTick = 0;
  #finished = false;
  #bestTime: number | null = null;
  readonly #splits: number[] = [];

  constructor(characterId: CharacterId, spawnIndex: number, ai: boolean) {
    this.characterId = characterId;
    this.#x = TRACK_GEOMETRY.centerX + TRACK_RADIUS;
    this.#z = TRACK_CENTER_Z + spawnIndex * (KART_BOUNDING_RADIUS * 2 + 1);
    if (ai) {
      // R11 placeholder only: deterministic stationary opponents.  AI driving
      // decisions are intentionally deferred until their behavior bar exists.
      this.#throttle = 0;
      this.#brake = true;
    }
  }

  setInput(input: WorldInput): void {
    if (input.throttle !== undefined) {
      this.#throttle = clamp(input.throttle, 0, 1);
    }
    if (input.steer !== undefined) {
      const steer = clamp(input.steer, -1, 1);
      this.#steer = Math.abs(steer) < STEER_DEADZONE ? 0 : steer;
    }
    if (input.brake !== undefined) {
      this.#brake = input.brake;
    }
    if (input.reverse !== undefined) {
      this.#reverse = input.reverse;
    }
    if (input.drift !== undefined) {
      if (input.drift && !this.#driftHeld) {
        this.#driftBufferPending = true;
        this.#driftBufferExpiryTick = this.#currentTick + DRIFT_INPUT_BUFFER_TICKS;
      }
      this.#driftHeld = input.drift;
    }
    if (input.jump !== undefined) {
      if (input.jump && !this.#jumpHeld) this.#jumpQueued = true;
      this.#jumpHeld = input.jump;
    }
  }

  step(dt: number, tick: number): void {
    this.#collisionImpulse = 0;
    this.#currentTick = tick;
    this.#stepDriftState(dt);
    this.#stepVertical(dt);

    const oldForwardX = Math.sin(this.#yaw);
    const oldForwardZ = Math.cos(this.#yaw);
    const oldLongitudinalSpeed = this.#vx * oldForwardX + this.#vz * oldForwardZ;
    this.#stepYaw(dt, oldLongitudinalSpeed);
    this.#stepDrive(dt);
    this.#stepPosition(dt);
    this.#resolveTrackCollision();
    this.#updateSurface();

    this.#updateLapState(dt, tick);
  }

  snapshot(fixedDt: number): { kart: KartState; lap: LapState } {
    const speed = Math.hypot(this.#vx, this.#vy, this.#vz);
    const kart: KartState = {
      characterId: this.characterId,
      pos: [this.#x, this.#y, this.#z],
      vel: [this.#vx, this.#vy, this.#vz],
      speed,
      yaw: this.#yaw,
      yawRate: this.#yawRate,
      steerInput: this.#steer,
      throttleInput: this.#throttle,
      driftState: this.#driftState,
      driftCharge: this.#driftCharge,
      driftTier: this.#driftTier,
      grounded: this.#grounded,
      surface: this.#surface,
      collisionImpulse: this.#collisionImpulse,
    };
    const lapTime = this.#finished
      ? this.#splits[this.#splits.length - 1] ?? 0
      : (this.#currentTick - this.#lapStartTick) * fixedDt;
    const lap: LapState = {
      current: this.#currentLap,
      total: TOTAL_LAPS,
      currentTime: lapTime,
      bestTime: this.#bestTime,
      splits: this.#splits.slice(),
    };
    return { kart, lap };
  }

  get x(): number {
    return this.#x;
  }

  get z(): number {
    return this.#z;
  }

  get vx(): number {
    return this.#vx;
  }

  get vz(): number {
    return this.#vz;
  }

  get collisionImpulse(): number {
    return this.#collisionImpulse;
  }

  translate(dx: number, dz: number): void {
    this.#x += dx;
    this.#z += dz;
  }

  addVelocity(dx: number, dz: number): void {
    this.#vx += dx;
    this.#vz += dz;
  }

  markCollisionImpulse(impulse: number): void {
    this.#collisionImpulse = Math.max(this.#collisionImpulse, impulse);
  }

  #currentTick = 0;

  #stepDriftState(dt: number): void {
    if (this.#driftState === 'none') {
      const speed = Math.hypot(this.#vx, this.#vz);
      if (this.#driftBufferPending && this.#currentTick > this.#driftBufferExpiryTick) {
        this.#driftBufferPending = false;
      }
      const bufferedStart = !this.#driftHeld && this.#driftBufferPending;
      if ((this.#driftHeld || bufferedStart)
        && Math.abs(this.#steer) > 0.0001
        && speed >= DRIFT_ENTRY_SPEED) {
        this.#driftState = 'charging';
        this.#driftTime = 0;
        this.#driftCharge = 0;
        this.#driftTier = 0;
        this.#driftBufferedActivation = bufferedStart;
        this.#driftBufferPending = false;
      }
      return;
    }

    if (this.#driftState === 'charging') {
      if ((!this.#driftHeld && !this.#driftBufferedActivation)
        || Math.abs(this.#steer) <= 0.0001) {
        if (this.#driftTier > 0) {
          this.#releaseDrift();
        } else {
          this.#cancelDrift();
        }
        return;
      }

      this.#driftTime += dt;
      this.#driftCharge = clamp(this.#driftTime / DRIFT_TIER3_TIME, 0, 1);
      this.#driftTier = this.#driftTime >= DRIFT_TIER3_TIME
        ? 3
        : this.#driftTime >= DRIFT_TIER2_TIME
          ? 2
          : this.#driftTime >= DRIFT_TIER1_TIME
            ? 1
            : 0;
      // A released early press gets one charging frame when the buffered
      // condition is met; a held press follows the normal path above.
      this.#driftBufferedActivation = false;
      return;
    }

    this.#releaseTimer = Math.max(0, this.#releaseTimer - dt);
    if (this.#releaseTimer === 0) {
      this.#driftState = 'none';
      this.#driftCharge = 0;
      this.#driftTier = 0;
      this.#driftTime = 0;
      this.#boostSpeed = 0;
    }
  }

  #cancelDrift(): void {
    this.#driftState = 'none';
    this.#driftCharge = 0;
    this.#driftTier = 0;
    this.#driftTime = 0;
    this.#driftBufferedActivation = false;
    this.#driftBufferPending = false;
  }

  #releaseDrift(): void {
    const tier = this.#driftTier;
    const releaseDuration = tier === 1
      ? 0.8
      : tier === 2
        ? MINI_TURBO_DURATION
        : 1.3;
    this.#driftState = 'released';
    this.#driftCharge = 1;
    this.#releaseTimer = releaseDuration;
    this.#boostSpeed = (MINI_TURBO_GAIN_BY_TIER[tier] * CAR_LENGTH) / releaseDuration;
    this.#driftBufferedActivation = false;
    this.#driftBufferPending = false;
  }

  #stepVertical(dt: number): void {
    if (this.#jumpQueued && this.#grounded) {
      this.#vy = JUMP_SPEED;
      this.#grounded = false;
      this.#jumpQueued = false;
    }

    if (this.#grounded) {
      this.#y = 0;
      this.#vy = 0;
      return;
    }

    this.#vy -= GRAVITY * dt;
    this.#y += this.#vy * dt;
    if (this.#y <= 0) {
      const retention = landingHorizontalRetention(Math.hypot(this.#vx, this.#vz), Math.abs(this.#vy));
      this.#vx *= retention;
      this.#vz *= retention;
      this.#y = 0;
      this.#vy = 0;
      this.#grounded = true;
    }
  }

  #stepYaw(dt: number, longitudinalSpeed: number): void {
    const speedRatio = clamp(Math.abs(longitudinalSpeed) / BASE_TOP_SPEED, 0, 1);
    const sameDirection = this.#steer === 0
      || this.#steerCommand === 0
      || Math.sign(this.#steer) === Math.sign(this.#steerCommand);
    const releasingSteer = sameDirection && Math.abs(this.#steer) < Math.abs(this.#steerCommand);
    const timeConstant = releasingSteer
      ? STEER_RELEASE_TIME_CONSTANT
      : STEER_RISE_TIME_CONSTANT;
    const response = 1 - Math.exp(-dt / timeConstant);
    this.#steerCommand += (this.#steer - this.#steerCommand) * response;
    const controlRatio = this.#grounded ? 1 : AIR_CONTROL_RATIO;
    const driftRatio = this.#driftState === 'charging' ? DRIFT_YAW_RATE_RATIO : 1;
    const driftSteering = this.#driftState !== 'none';
    const steeringInput = driftSteering ? this.#steer : this.#steerCommand;
    const steerMagnitude = Math.abs(steeringInput);
    const speedCurveBlend = clamp((steerMagnitude - 0.25) / 0.75, 0, 1);
    const speedFactor = speedRatio * (1 - speedCurveBlend)
      + Math.sqrt(speedRatio) * speedCurveBlend;
    const steeringRate = steeringInput * MAX_STEER_YAW_RATE * speedFactor * controlRatio * driftRatio;
    this.#yawRate = steeringRate;
    this.#yaw = wrapAngle(this.#yaw + this.#yawRate * dt);
    if (this.#yaw > Math.PI) this.#yaw -= Math.PI * 2;
  }

  #stepDrive(dt: number): void {
    const forwardX = Math.sin(this.#yaw);
    const forwardZ = Math.cos(this.#yaw);
    const lateralX = Math.cos(this.#yaw);
    const lateralZ = -Math.sin(this.#yaw);
    const surfaceFactor = surfaceSpeedFactor(this.#surface);
    const surfaceForwardTopSpeed = BASE_TOP_SPEED * surfaceFactor;
    const surfaceReverseTopSpeed = REVERSE_TOP_SPEED * surfaceFactor;
    const previousGroundSpeed = Math.hypot(this.#vx, this.#vz);
    let longitudinalSpeed = this.#vx * forwardX + this.#vz * forwardZ;
    const lateralSpeed = this.#vx * lateralX + this.#vz * lateralZ;
    let targetGroundSpeed: number | null = null;

    if (this.#brake) {
      longitudinalSpeed = moveTowardZero(longitudinalSpeed, BRAKE_DECELERATION * dt);
    } else if (this.#throttle > 0) {
      if (this.#reverse) {
        const reverseRatio = clamp(Math.abs(Math.min(0, longitudinalSpeed)) / surfaceReverseTopSpeed, 0, 1);
        const reverseAcceleration = ENGINE_ACCELERATION * (1 - reverseRatio * reverseRatio);
        longitudinalSpeed -= reverseAcceleration * this.#throttle * dt;
        longitudinalSpeed = Math.max(-surfaceReverseTopSpeed, longitudinalSpeed);
        targetGroundSpeed = Math.min(
          surfaceReverseTopSpeed,
          previousGroundSpeed + reverseAcceleration * this.#throttle * dt,
        );
      } else {
        const forwardRatio = clamp(Math.max(0, longitudinalSpeed) / surfaceForwardTopSpeed, 0, 1);
        const forwardAcceleration = ENGINE_ACCELERATION * (1 - forwardRatio * forwardRatio);
        longitudinalSpeed += forwardAcceleration * this.#throttle * dt;
        longitudinalSpeed = Math.min(surfaceForwardTopSpeed, longitudinalSpeed);
        targetGroundSpeed = Math.min(
          surfaceForwardTopSpeed,
          previousGroundSpeed + forwardAcceleration * this.#throttle * dt,
        );
      }
    } else {
      longitudinalSpeed = moveTowardZero(longitudinalSpeed, COAST_DECELERATION * dt);
    }

    const lateralRetention = Math.max(0, 1 - LATERAL_GRIP * dt);
    this.#vx = forwardX * longitudinalSpeed + lateralX * lateralSpeed * lateralRetention;
    this.#vz = forwardZ * longitudinalSpeed + lateralZ * lateralSpeed * lateralRetention;

    // Turning creates a small lateral component.  Keep engine acceleration
    // tied to total ground speed so a valid racing line does not lose top speed
    // merely because the velocity vector is no longer parallel to the kart.
    const groundSpeed = Math.hypot(this.#vx, this.#vz);
    if (targetGroundSpeed !== null && groundSpeed > 0) {
      const scale = targetGroundSpeed / groundSpeed;
      this.#vx *= scale;
      this.#vz *= scale;
    }

    const speedLimit = this.#reverse ? surfaceReverseTopSpeed : surfaceForwardTopSpeed;
    const cappedGroundSpeed = Math.hypot(this.#vx, this.#vz);
    if (cappedGroundSpeed > speedLimit) {
      const scale = speedLimit / cappedGroundSpeed;
      this.#vx *= scale;
      this.#vz *= scale;
    }
  }

  #stepPosition(dt: number): void {
    this.#x += this.#vx * dt;
    this.#z += this.#vz * dt;
    if (this.#driftState === 'released' && this.#releaseTimer > 0) {
      this.#x += Math.sin(this.#yaw) * this.#boostSpeed * dt;
      this.#z += Math.cos(this.#yaw) * this.#boostSpeed * dt;
    }
  }

  #resolveTrackCollision(): void {
    const dx = this.#x - TRACK_GEOMETRY.centerX;
    const dz = this.#z - TRACK_CENTER_Z;
    const radius = Math.hypot(dx, dz);
    if (radius === 0) return;

    const normalX = dx / radius;
    const normalZ = dz / radius;
    let boundary = 0;
    let towardBoundary = 0;
    const tangentX = -normalZ;
    const tangentZ = normalX;

    if (radius > OUTER_COLLISION_RADIUS) {
      boundary = OUTER_COLLISION_RADIUS;
      towardBoundary = this.#vx * normalX + this.#vz * normalZ;
    } else if (radius < INNER_COLLISION_RADIUS) {
      boundary = INNER_COLLISION_RADIUS;
      towardBoundary = -(this.#vx * normalX + this.#vz * normalZ);
    } else {
      return;
    }

    this.#x = TRACK_GEOMETRY.centerX + normalX * boundary;
    this.#z = TRACK_CENTER_Z + normalZ * boundary;

    const tangentSpeed = this.#vx * tangentX + this.#vz * tangentZ;
    const normalSpeed = this.#vx * normalX + this.#vz * normalZ;
    if (towardBoundary > 0) {
      const incidenceAngleDeg = Math.atan2(Math.abs(tangentSpeed), towardBoundary) * 180 / Math.PI;
      const grazingBlend = clamp(
        (incidenceAngleDeg - WALL_HEAD_ON_ANGLE_DEG)
          / (WALL_GRAZING_ANGLE_DEG - WALL_HEAD_ON_ANGLE_DEG),
        0,
        1,
      );
      const grazingBounce = WALL_BOUNCE + (WALL_GRAZING_BOUNCE - WALL_BOUNCE) * grazingBlend;
      const defaultBlend = clamp((incidenceAngleDeg - WALL_GRAZING_ANGLE_DEG) / 15, 0, 1);
      const wallBounce = grazingBounce * (1 - defaultBlend)
        + WALL_DEFAULT_BOUNCE * defaultBlend;
      const reflectedNormalSpeed = radius > boundary
        ? -towardBoundary * wallBounce
        : towardBoundary * wallBounce;
      this.#vx = tangentX * tangentSpeed + normalX * reflectedNormalSpeed;
      this.#vz = tangentZ * tangentSpeed + normalZ * reflectedNormalSpeed;
      this.#collisionImpulse = Math.abs(towardBoundary - reflectedNormalSpeed);
    } else {
      // A penetrating pose with no outward velocity is a positional correction,
      // not a new impact. Keep the velocity and leave collisionImpulse at zero
      // so telemetry does not report a stationary wall contact as a hit every
      // tick.
      this.#collisionImpulse = 0;
      this.#vx = tangentX * tangentSpeed + normalX * normalSpeed;
      this.#vz = tangentZ * tangentSpeed + normalZ * normalSpeed;
    }
  }

  #updateSurface(): void {
    const dx = this.#x - TRACK_GEOMETRY.centerX;
    const dz = this.#z - TRACK_CENTER_Z;
    this.#surface = surfaceAtPosition(Math.atan2(dz, dx));
  }

  #updateLapState(dt: number, tick: number): void {
    const angle = wrapAngle(Math.atan2(this.#z - TRACK_CENTER_Z, this.#x - TRACK_GEOMETRY.centerX));
    const crossedStartLine = this.#hasLeftStartLine
      && this.#trackAngle >= START_LINE_RETURN_ANGLE
      && angle <= START_LINE_CROSS_ANGLE;

    if (!this.#hasLeftStartLine && angle >= START_LINE_LEAVE_ANGLE) {
      this.#hasLeftStartLine = true;
    }

    if (crossedStartLine && !this.#finished && this.#currentLap <= TOTAL_LAPS) {
      const lapTime = (tick - this.#lapStartTick) * dt;
      this.#splits.push(lapTime);
      if (this.#bestTime === null || lapTime < this.#bestTime) {
        this.#bestTime = lapTime;
      }
      if (this.#currentLap < TOTAL_LAPS) {
        this.#currentLap += 1;
        this.#lapStartTick = tick;
      } else {
        this.#finished = true;
      }
    }

    this.#trackAngle = angle;
  }
}

class World implements PhysicsWorld {
  #tick = 0;
  #fixedDt: number | null = null;
  readonly #playerIndex = 0;
  readonly #karts: Kart[];

  constructor(options: WorldOptions = {}) {
    this.#karts = [new Kart(options.playerCharacterId ?? 'xiaohong', 0, false)];
    for (const [index, opponent] of (options.aiOpponents ?? []).entries()) {
      this.#karts.push(new Kart(opponent.characterId, index + 1, true));
    }
  }

  setInput(input: WorldInput): void {
    this.#karts[this.#playerIndex]!.setInput(input);
  }

  step(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) {
      throw new RangeError(`World.step() requires a positive fixed dt, got ${dt}`);
    }
    if (this.#fixedDt === null) this.#fixedDt = dt;
    if (dt !== this.#fixedDt) {
      throw new RangeError(`World.step() requires a fixed dt (${this.#fixedDt}), got ${dt}`);
    }
    const fixedDt = this.#fixedDt;

    this.#tick += 1;
    for (const kart of this.#karts) {
      kart.step(fixedDt, this.#tick);
    }
    this.#resolveKartCollisions();
  }

  snapshot(): SimSnapshot {
    const fixedDt = this.#fixedDt ?? 0;
    const snapshots = this.#karts.map((kart) => kart.snapshot(fixedDt));
    return {
      tick: this.#tick,
      t: this.#tick * fixedDt,
      karts: snapshots.map(({ kart }) => kart),
      playerIndex: this.#playerIndex,
      laps: snapshots.map(({ lap }) => lap),
    };
  }

  #resolveKartCollisions(): void {
    const minimumDistance = KART_BOUNDING_RADIUS * 2;
    for (let firstIndex = 0; firstIndex < this.#karts.length; firstIndex += 1) {
      const first = this.#karts[firstIndex]!;
      for (let secondIndex = firstIndex + 1; secondIndex < this.#karts.length; secondIndex += 1) {
        const second = this.#karts[secondIndex]!;
        const dx = second.x - first.x;
        const dz = second.z - first.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= minimumDistance) continue;

        const normalX = distance > 1e-12 ? dx / distance : 1;
        const normalZ = distance > 1e-12 ? dz / distance : 0;
        const overlap = minimumDistance - distance;
        first.translate(-normalX * overlap * 0.5, -normalZ * overlap * 0.5);
        second.translate(normalX * overlap * 0.5, normalZ * overlap * 0.5);

        const relativeNormalSpeed = (second.vx - first.vx) * normalX
          + (second.vz - first.vz) * normalZ;
        if (relativeNormalSpeed >= 0) continue;

        // Equal-mass impulse: both cars receive the same magnitude, making the
        // symmetry metric a physical consequence rather than a telemetry value.
        const impulse = -(1 + KART_BOUNCE) * relativeNormalSpeed * 0.5;
        first.addVelocity(-normalX * impulse, -normalZ * impulse);
        second.addVelocity(normalX * impulse, normalZ * impulse);
        first.markCollisionImpulse(impulse);
        second.markCollisionImpulse(impulse);
      }
    }
  }
}

export function createWorld(options?: WorldOptions): PhysicsWorld {
  return new World(options);
}

// Public physics API for renderers and headless tooling.
export { BASE_TOP_SPEED, CAR_LENGTH, CAR_WIDTH, TRACK_GEOMETRY } from './constants.js';
