// SDF primitive functions

import type { Vec3 } from "./types";

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
