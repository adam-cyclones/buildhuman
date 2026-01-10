// SDF primitive functions and gradient computation

import type { Vec3 } from "./types";

// Small epsilon for numerical gradient computation
const EPSILON = 0.0001;

/**
 * Signed distance function for a sphere
 * Returns distance from point to sphere surface (negative = inside)
 */
export function sphereSDF(point: Vec3, center: Vec3, radius: number): number {
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const dz = point[2] - center[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return distance - radius;
}

/**
 * Signed distance function for a capsule (line segment with rounded ends)
 * @param point - Point to evaluate
 * @param a - Start point of line segment
 * @param b - End point of line segment
 * @param radius - Radius of rounded ends
 * @returns Distance from point to capsule surface (negative = inside)
 */
export function capsuleSDF(point: Vec3, a: Vec3, b: Vec3, radius: number): number {
  // Vector from a to b
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];

  // Vector from a to point
  const pa = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];

  // Project point onto line segment (clamped to [0, 1])
  const baDot = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2];
  const paDot = pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2];
  const h = Math.max(0, Math.min(1, paDot / baDot));

  // Closest point on line segment
  const closest = [
    a[0] + ba[0] * h,
    a[1] + ba[1] * h,
    a[2] + ba[2] * h,
  ];

  // Distance from point to closest point on segment
  const dx = point[0] - closest[0];
  const dy = point[1] - closest[1];
  const dz = point[2] - closest[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return distance - radius;
}

/**
 * Polynomial smooth minimum for organic blending between SDFs
 * Creates smooth, natural transitions between shapes
 *
 * @param a - First SDF value
 * @param b - Second SDF value
 * @param k - Blend radius (higher = smoother but larger blend zone)
 * @returns Blended distance value
 */
export function smoothMinPoly(a: number, b: number, k: number = 0.1): number {
  const h = Math.max(k - Math.abs(a - b), 0.0);
  return Math.min(a, b) - h * h * 0.25 / k;
}

/**
 * Compute gradient (normal) of sphere SDF
 * Gradient points in direction of increasing distance (away from surface)
 */
export function sphereGradient(point: Vec3, center: Vec3): Vec3 {
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const dz = point[2] - center[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Avoid division by zero at sphere center
  if (dist < EPSILON) {
    return [0, 1, 0]; // Arbitrary up direction
  }

  // Normalized gradient
  return [dx / dist, dy / dist, dz / dist];
}

/**
 * Compute numerical gradient using central differences
 * Works for any SDF evaluation function
 */
export function computeGradient(
  point: Vec3,
  evaluateSDF: (p: Vec3) => number
): Vec3 {
  const x = point[0];
  const y = point[1];
  const z = point[2];

  const dx = (
    evaluateSDF([x + EPSILON, y, z]) -
    evaluateSDF([x - EPSILON, y, z])
  ) / (2 * EPSILON);

  const dy = (
    evaluateSDF([x, y + EPSILON, z]) -
    evaluateSDF([x, y - EPSILON, z])
  ) / (2 * EPSILON);

  const dz = (
    evaluateSDF([x, y, z + EPSILON]) -
    evaluateSDF([x, y, z - EPSILON])
  ) / (2 * EPSILON);

  // Normalize
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < EPSILON) {
    return [0, 1, 0];
  }

  return [dx / len, dy / len, dz / len];
}
