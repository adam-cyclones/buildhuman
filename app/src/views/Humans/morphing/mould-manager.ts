// MouldManager: Combines multiple moulds into single SDF
// Moulds are now defined in bone-local space and transformed to world space

import type { Mould, Vec3 } from "./types";
import type { Skeleton } from "./skeleton";
import { sphereSDF, capsuleSDF, smoothMinPoly } from "./sdf";

export class MouldManager {
  private moulds: Map<string, Mould> = new Map();
  private skeleton: Skeleton | null = null;

  /**
   * Set the skeleton that moulds are attached to
   */
  setSkeleton(skeleton: Skeleton): void {
    this.skeleton = skeleton;
  }

  /**
   * Add a mould to the system
   * NOTE: center and endPoint are now in BONE-LOCAL space
   */
  addMould(mould: Mould): void {
    this.moulds.set(mould.id, mould);
  }

  /**
   * Get a mould by ID
   */
  getMould(id: string): Mould | undefined {
    return this.moulds.get(id);
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
   * Get world position of a mould's center
   * Transforms from bone-local space to world space
   */
  private getMouldWorldCenter(mouldId: string): Vec3 {
    const mould = this.moulds.get(mouldId);
    if (!mould) {
      return [0, 0, 0];
    }

    // If no skeleton or no parent joint, use mould center directly (fallback)
    if (!this.skeleton || !mould.parentJointId) {
      return mould.center;
    }

    // Transform from bone-local to world space
    return this.skeleton.transformToWorld(mould.parentJointId, mould.center);
  }

  /**
   * Get world position of a mould's endpoint (for capsules)
   * Transforms from bone-local space to world space
   */
  private getMouldWorldEndpoint(mould: Mould): Vec3 {
    if (!mould.endPoint) {
      return [0, 0, 0];
    }

    // If no skeleton or no parent joint, use endpoint directly (fallback)
    if (!this.skeleton || !mould.parentJointId) {
      return mould.endPoint;
    }

    // Transform from bone-local to world space
    return this.skeleton.transformToWorld(mould.parentJointId, mould.endPoint);
  }

  /**
   * Evaluate SDF for a single mould
   */
  private evaluateMouldSDF(mould: Mould, point: Vec3): number {
    const center = this.getMouldWorldCenter(mould.id);

    if (mould.shape === "capsule" && mould.endPoint) {
      const endPoint = this.getMouldWorldEndpoint(mould);
      return capsuleSDF(point, center, endPoint, mould.radius);
    }

    // Default to sphere
    return sphereSDF(point, center, mould.radius);
  }

  /**
   * Evaluate combined SDF at a point
   * All moulds are blended together using smooth minimum
   * Moulds are now properly attached to bone frames
   */
  evaluateSDF(point: Vec3): number {
    const mouldArray = Array.from(this.moulds.values());

    if (mouldArray.length === 0) {
      // No moulds: return large positive distance (far outside)
      return 1000;
    }

    if (mouldArray.length === 1) {
      // Single mould: just evaluate directly
      return this.evaluateMouldSDF(mouldArray[0], point);
    }

    // Multiple moulds: blend them together
    let result = this.evaluateMouldSDF(mouldArray[0], point);

    for (let i = 1; i < mouldArray.length; i++) {
      const mould = mouldArray[i];
      const distance = this.evaluateMouldSDF(mould, point);
      const blendRadius = mould.blendRadius ?? 0.1;
      result = smoothMinPoly(result, distance, blendRadius);
    }

    return result;
  }
}
