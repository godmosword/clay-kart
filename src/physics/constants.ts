/** Physics-side contract values shared by the simulation and other consumers. */
export const BASE_TOP_SPEED = 24;
export const CAR_LENGTH = 2.4;
export const CAR_WIDTH = 1.4;

/** Minimum effective reverse input when the reverse control is held alone. */
export const REVERSE_MIN_THROTTLE = 0.25;
/** Contact tolerance for a kart resting exactly on an annular wall boundary. */
export const WALL_CONTACT_EPSILON = 1e-6;
/** Low-speed steering authority retained while a grounded kart touches a wall. */
export const WALL_STEER_SPEED_RATIO = 0.25;

export interface TrackGeometry {
  readonly centerX: number;
  readonly centerZ: number;
  /** Centerline radius, not the kart collision radius. */
  readonly radius: number;
  /** Half-width of the asphalt track, before kart bounds are applied. */
  readonly halfWidth: number;
}

/**
 * Renderable track geometry.  `radius` and `halfWidth` describe the track
 * itself; the kart bounding radius is deliberately not part of this object.
 * Object.freeze keeps renderer code from mutating the physics contract.
 */
export const TRACK_GEOMETRY: TrackGeometry = Object.freeze({
  centerX: 0,
  centerZ: 30,
  radius: 30,
  halfWidth: 6,
});

/** Named aliases for consumers that only need individual track dimensions. */
export const TRACK_RADIUS = TRACK_GEOMETRY.radius;
export const TRACK_CENTER_Z = TRACK_GEOMETRY.centerZ;
export const TRACK_HALF_WIDTH = TRACK_GEOMETRY.halfWidth;

/**
 * Fixed item-box slots on the racing line.  The slot positions are physics
 * data rather than renderer-owned scene decoration so every headless replay
 * and browser run sees the same pickup geometry.
 */
export interface ItemBoxDefinition {
  readonly id: string;
  readonly angle: number;
  readonly position: readonly [number, number, number];
}

function itemBox(id: string, angle: number): ItemBoxDefinition {
  return Object.freeze({
    id,
    angle,
    position: Object.freeze([
      TRACK_GEOMETRY.centerX + TRACK_GEOMETRY.radius * Math.cos(angle),
      0,
      TRACK_GEOMETRY.centerZ + TRACK_GEOMETRY.radius * Math.sin(angle),
    ] as [number, number, number]),
  });
}

export const ITEM_BOXES: readonly ItemBoxDefinition[] = Object.freeze([
  itemBox('item-box-0', 0.55),
  itemBox('item-box-1', 2.05),
  itemBox('item-box-2', 3.65),
  itemBox('item-box-3', 5.15),
]);

/** A kart entering this radius claims an available box. */
export const ITEM_BOX_PICKUP_RADIUS = 2.2;
/** Three seconds at the fixed 120 Hz tick after a box is collected. */
export const ITEM_BOX_RESPAWN_TICKS = 360;
