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
