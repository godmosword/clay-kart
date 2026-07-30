/**
 * Deterministic W1 kart simulation.
 *
 * This module deliberately contains no rendering or browser dependencies.  The
 * track is an annular collider: the kart's centre is guided around its asphalt
 * lane when no steering input is supplied, while steering can move it toward
 * either boundary.  The guide is useful during W1 because the bootstrap has no
 * input device yet; callers can use setInput() for headless and future UI input.
 */
import type { KartState, LapState, SimSnapshot, SimWorld } from '@loader/bootstrap';

const TICK_HZ = 120;
const TICK_DT = 1 / TICK_HZ;
const TOTAL_LAPS = 3;
const BASE_TOP_SPEED = 24;
const REVERSE_TOP_SPEED = BASE_TOP_SPEED * 0.4;
const ENGINE_ACCELERATION = 16.5;
const COAST_DECELERATION = 5.2;
const BRAKE_DECELERATION = 24;
const GRAVITY = 30;
const JUMP_SPEED = 10;
const TRACK_RADIUS = 30;
const TRACK_CENTER_Z = 30;
const TRACK_HALF_WIDTH = 6;
const CAR_LENGTH = 2.4;
const CAR_WIDTH = 1.4;
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

function yawForTrackAngle(angle: number): number {
  // The track is x = R cos(a), z = C + R sin(a), so its forward tangent is
  // (-sin(a), cos(a)) in the x/z plane.
  return Math.atan2(-Math.sin(angle), Math.cos(angle));
}

class World implements PhysicsWorld {
  #tick = 0;
  #x = TRACK_RADIUS;
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
    if (dt !== TICK_DT) {
      throw new RangeError(`World.step() requires TICK_DT (${TICK_DT}), got ${dt}`);
    }

    this.#tick += 1;
    this.#collisionImpulse = 0;

    this.#stepVertical(TICK_DT);

    const oldForwardX = Math.sin(this.#yaw);
    const oldForwardZ = Math.cos(this.#yaw);
    const oldLongitudinalSpeed = this.#vx * oldForwardX + this.#vz * oldForwardZ;
    this.#stepYaw(TICK_DT, oldLongitudinalSpeed);
    this.#stepDrive(TICK_DT);
    this.#stepPosition(TICK_DT);
    this.#resolveTrackCollision();

    // The no-input path is an assisted W1 drive so the skeleton can be
    // inspected without a controller.  Explicit steering opts out and gives
    // the caller the full collider response.
    if (Math.abs(this.#steer) < 0.0001 && this.#grounded) {
      this.#followTrackCentreline();
    }

    this.#updateLapState();
  }

  snapshot(): SimSnapshot {
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
      : (this.#tick - this.#lapStartTick) / TICK_HZ;
    const lap: LapState = {
      current: this.#currentLap,
      total: TOTAL_LAPS,
      currentTime: lapTime,
      bestTime: this.#bestTime,
      splits: this.#splits.slice(),
    };
    return { tick: this.#tick, t: this.#tick / TICK_HZ, kart, lap };
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
    const trackRate = -longitudinalSpeed / TRACK_RADIUS;
    const speedRatio = clamp(Math.abs(longitudinalSpeed) / BASE_TOP_SPEED, 0, 1);
    const controlRatio = this.#grounded ? 1 : AIR_CONTROL_RATIO;
    const steeringRate = this.#steer * MAX_STEER_YAW_RATE * speedRatio * controlRatio;
    this.#yawRate = trackRate + steeringRate;
    this.#yaw = wrapAngle(this.#yaw + this.#yawRate * dt);
    if (this.#yaw > Math.PI) this.#yaw -= Math.PI * 2;
  }

  #stepDrive(dt: number): void {
    const forwardX = Math.sin(this.#yaw);
    const forwardZ = Math.cos(this.#yaw);
    const lateralX = Math.cos(this.#yaw);
    const lateralZ = -Math.sin(this.#yaw);
    let longitudinalSpeed = this.#vx * forwardX + this.#vz * forwardZ;
    const lateralSpeed = this.#vx * lateralX + this.#vz * lateralZ;

    if (this.#brake) {
      longitudinalSpeed = moveTowardZero(longitudinalSpeed, BRAKE_DECELERATION * dt);
    } else if (this.#throttle > 0) {
      if (this.#reverse) {
        const reverseRatio = clamp(Math.abs(Math.min(0, longitudinalSpeed)) / REVERSE_TOP_SPEED, 0, 1);
        const reverseAcceleration = ENGINE_ACCELERATION * (1 - reverseRatio * reverseRatio);
        longitudinalSpeed -= reverseAcceleration * this.#throttle * dt;
        longitudinalSpeed = Math.max(-REVERSE_TOP_SPEED, longitudinalSpeed);
      } else {
        const forwardRatio = clamp(Math.max(0, longitudinalSpeed) / BASE_TOP_SPEED, 0, 1);
        const forwardAcceleration = ENGINE_ACCELERATION * (1 - forwardRatio * forwardRatio);
        longitudinalSpeed += forwardAcceleration * this.#throttle * dt;
        longitudinalSpeed = Math.min(BASE_TOP_SPEED, longitudinalSpeed);
      }
    } else {
      longitudinalSpeed = moveTowardZero(longitudinalSpeed, COAST_DECELERATION * dt);
    }

    const lateralRetention = Math.max(0, 1 - LATERAL_GRIP * dt);
    this.#vx = forwardX * longitudinalSpeed + lateralX * lateralSpeed * lateralRetention;
    this.#vz = forwardZ * longitudinalSpeed + lateralZ * lateralSpeed * lateralRetention;
  }

  #stepPosition(dt: number): void {
    this.#x += this.#vx * dt;
    this.#z += this.#vz * dt;
  }

  #resolveTrackCollision(): void {
    const dx = this.#x;
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
    this.#x = normalX * boundary;
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
      this.#collisionImpulse = penetration / TICK_DT;
      // A penetrating pose with no outward velocity is still corrected above;
      // preserve its tangential motion rather than letting the wall trap it.
      this.#vx = tangentX * tangentSpeed + normalX * normalSpeed;
      this.#vz = tangentZ * tangentSpeed + normalZ * normalSpeed;
    }
  }

  #followTrackCentreline(): void {
    const dx = this.#x;
    const dz = this.#z - TRACK_CENTER_Z;
    const radius = Math.hypot(dx, dz);
    if (radius < 0.000001) return;

    const angle = Math.atan2(dz, dx);
    const normalX = Math.cos(angle);
    const normalZ = Math.sin(angle);
    const tangentX = -normalZ;
    const tangentZ = normalX;
    const trackSpeed = this.#vx * tangentX + this.#vz * tangentZ;
    this.#x = TRACK_RADIUS * normalX;
    this.#z = TRACK_CENTER_Z + TRACK_RADIUS * normalZ;
    this.#vx = tangentX * trackSpeed;
    this.#vz = tangentZ * trackSpeed;
    this.#yaw = yawForTrackAngle(angle);
    this.#yawRate = -trackSpeed / TRACK_RADIUS;
  }

  #updateLapState(): void {
    const angle = wrapAngle(Math.atan2(this.#z - TRACK_CENTER_Z, this.#x));
    const crossedStartLine = this.#hasLeftStartLine
      && this.#trackAngle >= START_LINE_RETURN_ANGLE
      && angle <= START_LINE_CROSS_ANGLE;

    if (!this.#hasLeftStartLine && angle >= START_LINE_LEAVE_ANGLE) {
      this.#hasLeftStartLine = true;
    }

    if (crossedStartLine && !this.#finished && this.#currentLap <= TOTAL_LAPS) {
      const lapTime = (this.#tick - this.#lapStartTick) / TICK_HZ;
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
