// MouldManager: Combines multiple moulds into single SDF

import type { Mould, Vec3 } from "./types";
import { sphereSDF, smoothMinPoly } from "./sdf";

export class MouldManager {
  private moulds: Map<string, Mould> = new Map();

  /**
   * Add a mould to the system
   */
  addMould(mould: Mould): void {
    this.moulds.set(mould.id, mould);
  }

  /**
   * Remove a mould by ID
   */
  removeMould(id: string): void {
    this.moulds.delete(id);
  }

  /**
   * Get all moulds
   */
  getMoulds(): Mould[] {
    return Array.from(this.moulds.values());
  }

  /**
   * Clear all moulds
   */
  clear(): void {
    this.moulds.clear();
  }

  /**
   * Evaluate combined SDF at a point
   * All moulds are blended together using smooth minimum
   */
  evaluateSDF(point: Vec3): number {
    const mouldArray = Array.from(this.moulds.values());

    if (mouldArray.length === 0) {
      // No moulds: return large positive distance (far outside)
      return 1000;
    }

    if (mouldArray.length === 1) {
      // Single mould: just evaluate directly
      const mould = mouldArray[0];
      return sphereSDF(point, mould.center, mould.radius);
    }

    // Multiple moulds: blend them together
    let result = sphereSDF(point, mouldArray[0].center, mouldArray[0].radius);

    for (let i = 1; i < mouldArray.length; i++) {
      const mould = mouldArray[i];
      const distance = sphereSDF(point, mould.center, mould.radius);
      const blendRadius = mould.blendRadius ?? 0.1;
      result = smoothMinPoly(result, distance, blendRadius);
    }

    return result;
  }
}
