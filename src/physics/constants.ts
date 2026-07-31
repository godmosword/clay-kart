/** Physics-side contract values shared by the simulation and other consumers. */
export const BASE_TOP_SPEED = 24;
export const CAR_LENGTH = 2.4;
export const CAR_WIDTH = 1.4;

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
