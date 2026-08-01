/**
 * Deterministic W1 kart simulation.
 *
 * This module deliberately contains no rendering or browser dependencies.  The
 * track is an annular collider.  The kart is integrated freely in world space;
 * steering is the only source of yaw, so a released steering input really does
 * settle to zero.  Callers can use setInput() for headless and future UI input.
 */
import type { KartState, LapState, SimSnapshot, SimWorld } from '@loader/bootstrap';
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
const LATERAL_GRIP = 14;
const WALL_BOUNCE = 0.15;
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

function wrapAngle(angle: number): number {
  const wrapped = angle % (Math.PI * 2);
  return wrapped < 0 ? wrapped + Math.PI * 2 : wrapped;
}

class World implements PhysicsWorld {
  #tick = 0;
  #fixedDt: number | null = null;
  #x = TRACK_GEOMETRY.centerX + TRACK_RADIUS;
  #y = 0;
  #z = TRACK_CENTER_Z;
  #vx = 0;
  #vy = 0;
  #vz = 0;
  #yaw = 0;
  #yawRate = 0;
  #grounded = true;
  #collisionImpulse = 0;

  #throttle = 1;
  #steer = 0;
  #brake = false;
  #reverse = false;
  #jumpHeld = false;
  #jumpQueued = false;

  #trackAngle = 0;
  #hasLeftStartLine = false;
  #currentLap = 1;
  #lapStartTick = 0;
  #finished = false;
  #bestTime: number | null = null;
  readonly #splits: number[] = [];

  setInput(input: WorldInput): void {
    if (input.throttle !== undefined) {
      this.#throttle = clamp(input.throttle, 0, 1);
    }
    if (input.steer !== undefined) {
      this.#steer = clamp(input.steer, -1, 1);
    }
    if (input.brake !== undefined) {
      this.#brake = input.brake;
    }
    if (input.reverse !== undefined) {
      this.#reverse = input.reverse;
    }
    if (input.jump !== undefined) {
      if (input.jump && !this.#jumpHeld) this.#jumpQueued = true;
      this.#jumpHeld = input.jump;
    }
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
    this.#collisionImpulse = 0;

    this.#stepVertical(fixedDt);

    const oldForwardX = Math.sin(this.#yaw);
    const oldForwardZ = Math.cos(this.#yaw);
    const oldLongitudinalSpeed = this.#vx * oldForwardX + this.#vz * oldForwardZ;
    this.#stepYaw(fixedDt, oldLongitudinalSpeed);
    this.#stepDrive(fixedDt);
    this.#stepPosition(fixedDt);
    this.#resolveTrackCollision(fixedDt);

    this.#updateLapState(fixedDt);
  }

  snapshot(): SimSnapshot {
    const fixedDt = this.#fixedDt ?? 0;
    const speed = Math.hypot(this.#vx, this.#vy, this.#vz);
    const kart: KartState = {
      pos: [this.#x, this.#y, this.#z],
      vel: [this.#vx, this.#vy, this.#vz],
      speed,
      yaw: this.#yaw,
      yawRate: this.#yawRate,
      steerInput: this.#steer,
      throttleInput: this.#throttle,
      driftState: 'none',
      driftCharge: 0,
      driftTier: 0,
      grounded: this.#grounded,
      surface: 'asphalt',
      collisionImpulse: this.#collisionImpulse,
    };
    const lapTime = this.#finished
      ? this.#splits[this.#splits.length - 1] ?? 0
      : (this.#tick - this.#lapStartTick) * fixedDt;
    const lap: LapState = {
      current: this.#currentLap,
      total: TOTAL_LAPS,
      currentTime: lapTime,
      bestTime: this.#bestTime,
      splits: this.#splits.slice(),
    };
    return { tick: this.#tick, t: this.#tick * fixedDt, kart, lap };
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
      this.#y = 0;
      this.#vy = 0;
      this.#grounded = true;
    }
  }

  #stepYaw(dt: number, longitudinalSpeed: number): void {
    const speedRatio = clamp(Math.abs(longitudinalSpeed) / BASE_TOP_SPEED, 0, 1);
    const controlRatio = this.#grounded ? 1 : AIR_CONTROL_RATIO;
    const steeringRate = this.#steer * MAX_STEER_YAW_RATE * speedRatio * controlRatio;
    this.#yawRate = steeringRate;
    this.#yaw = wrapAngle(this.#yaw + this.#yawRate * dt);
    if (this.#yaw > Math.PI) this.#yaw -= Math.PI * 2;
  }

  #stepDrive(dt: number): void {
    const forwardX = Math.sin(this.#yaw);
    const forwardZ = Math.cos(this.#yaw);
    const lateralX = Math.cos(this.#yaw);
    const lateralZ = -Math.sin(this.#yaw);
    const previousGroundSpeed = Math.hypot(this.#vx, this.#vz);
    let longitudinalSpeed = this.#vx * forwardX + this.#vz * forwardZ;
    const lateralSpeed = this.#vx * lateralX + this.#vz * lateralZ;
    let targetGroundSpeed: number | null = null;

    if (this.#brake) {
      longitudinalSpeed = moveTowardZero(longitudinalSpeed, BRAKE_DECELERATION * dt);
    } else if (this.#throttle > 0) {
      if (this.#reverse) {
        const reverseRatio = clamp(Math.abs(Math.min(0, longitudinalSpeed)) / REVERSE_TOP_SPEED, 0, 1);
        const reverseAcceleration = ENGINE_ACCELERATION * (1 - reverseRatio * reverseRatio);
        longitudinalSpeed -= reverseAcceleration * this.#throttle * dt;
        longitudinalSpeed = Math.max(-REVERSE_TOP_SPEED, longitudinalSpeed);
        targetGroundSpeed = Math.min(
          REVERSE_TOP_SPEED,
          previousGroundSpeed + reverseAcceleration * this.#throttle * dt,
        );
      } else {
        const forwardRatio = clamp(Math.max(0, longitudinalSpeed) / BASE_TOP_SPEED, 0, 1);
        const forwardAcceleration = ENGINE_ACCELERATION * (1 - forwardRatio * forwardRatio);
        longitudinalSpeed += forwardAcceleration * this.#throttle * dt;
        longitudinalSpeed = Math.min(BASE_TOP_SPEED, longitudinalSpeed);
        targetGroundSpeed = Math.min(
          BASE_TOP_SPEED,
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
  }

  #stepPosition(dt: number): void {
    this.#x += this.#vx * dt;
    this.#z += this.#vz * dt;
  }

  #resolveTrackCollision(dt: number): void {
    const dx = this.#x - TRACK_GEOMETRY.centerX;
    const dz = this.#z - TRACK_CENTER_Z;
    const radius = Math.hypot(dx, dz);
    if (radius === 0) return;

    const normalX = dx / radius;
    const normalZ = dz / radius;
    let boundary = 0;
    let towardBoundary = 0;
    let tangentX = -normalZ;
    let tangentZ = normalX;

    if (radius > OUTER_COLLISION_RADIUS) {
      boundary = OUTER_COLLISION_RADIUS;
      towardBoundary = this.#vx * normalX + this.#vz * normalZ;
    } else if (radius < INNER_COLLISION_RADIUS) {
      boundary = INNER_COLLISION_RADIUS;
      towardBoundary = -(this.#vx * normalX + this.#vz * normalZ);
    } else {
      return;
    }

    const penetration = Math.abs(radius - boundary);
    this.#x = TRACK_GEOMETRY.centerX + normalX * boundary;
    this.#z = TRACK_CENTER_Z + normalZ * boundary;

    const tangentSpeed = this.#vx * tangentX + this.#vz * tangentZ;
    const normalSpeed = this.#vx * normalX + this.#vz * normalZ;
    if (towardBoundary > 0) {
      const reflectedNormalSpeed = radius > boundary
        ? -towardBoundary * WALL_BOUNCE
        : towardBoundary * WALL_BOUNCE;
      this.#vx = tangentX * tangentSpeed + normalX * reflectedNormalSpeed;
      this.#vz = tangentZ * tangentSpeed + normalZ * reflectedNormalSpeed;
      this.#collisionImpulse = Math.abs(towardBoundary - reflectedNormalSpeed);
    } else {
      this.#collisionImpulse = penetration / dt;
      // A penetrating pose with no outward velocity is still corrected above;
      // preserve its tangential motion rather than letting the wall trap it.
      this.#vx = tangentX * tangentSpeed + normalX * normalSpeed;
      this.#vz = tangentZ * tangentSpeed + normalZ * normalSpeed;
    }
  }

  #updateLapState(dt: number): void {
    const angle = wrapAngle(Math.atan2(this.#z - TRACK_CENTER_Z, this.#x - TRACK_GEOMETRY.centerX));
    const crossedStartLine = this.#hasLeftStartLine
      && this.#trackAngle >= START_LINE_RETURN_ANGLE
      && angle <= START_LINE_CROSS_ANGLE;

    if (!this.#hasLeftStartLine && angle >= START_LINE_LEAVE_ANGLE) {
      this.#hasLeftStartLine = true;
    }

    if (crossedStartLine && !this.#finished && this.#currentLap <= TOTAL_LAPS) {
      const lapTime = (this.#tick - this.#lapStartTick) * dt;
      this.#splits.push(lapTime);
      if (this.#bestTime === null || lapTime < this.#bestTime) {
        this.#bestTime = lapTime;
      }
      if (this.#currentLap < TOTAL_LAPS) {
        this.#currentLap += 1;
        this.#lapStartTick = this.#tick;
      } else {
        this.#finished = true;
      }
    }

    this.#trackAngle = angle;
  }
}

export function createWorld(): PhysicsWorld {
  return new World();
}

// Public physics API for renderers and headless tooling.
export { BASE_TOP_SPEED, CAR_LENGTH, CAR_WIDTH, TRACK_GEOMETRY } from './constants.js';
