// MouldManager: Combines multiple moulds into single SDF

import type { Mould, Vec3 } from "./types";
import type { Skeleton } from "./skeleton";
import { sphereSDF, capsuleSDF, smoothMinPoly } from "./sdf";

export class MouldManager {
  private moulds: Map<string, Mould> = new Map();
  private skeleton: Skeleton | null = null;
  private mouldLocalOffsets: Map<string, Vec3> = new Map(); // Store offset from joint

  /**
   * Set the skeleton that moulds are attached to
   */
  setSkeleton(skeleton: Skeleton): void {
    this.skeleton = skeleton;
  }

  /**
   * Add a mould to the system
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
   * Update a mould's local offset from its parent joint
   */
  setMouldOffset(mouldId: string, offset: Vec3): void {
    this.mouldLocalOffsets.set(mouldId, offset);
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
   * Get world position of a mould (joint position + local offset)
   * Falls back to mould.center if no skeleton or parentJointId
   */
  getMouldWorldCenter(mouldId: string): Vec3 {
    const mould = this.moulds.get(mouldId);
    if (!mould) {
      return [0, 0, 0];
    }

    // If no skeleton or no parent joint, use the mould's center directly
    if (!this.skeleton || !mould.parentJointId) {
      return mould.center;
    }

    // Get world position of parent joint
    const jointPos = this.skeleton.getWorldPosition(mould.parentJointId);
    const offset = this.mouldLocalOffsets.get(mouldId) ?? [0, 0, 0];

    return [
      jointPos[0] + offset[0],
      jointPos[1] + offset[1],
      jointPos[2] + offset[2],
    ];
  }

  /**
   * Evaluate SDF for a single mould
   */
  private evaluateMouldSDF(mould: Mould, point: Vec3): number {
    const center = this.getMouldWorldCenter(mould.id);

    if (mould.shape === "capsule" && mould.endPoint) {
      // For capsule, transform endPoint using same offset as center
      const offset = this.mouldLocalOffsets.get(mould.id) ?? [0, 0, 0];
      let endPoint = mould.endPoint;

      // If skeleton attached, apply joint transform to endPoint too
      if (this.skeleton && mould.parentJointId) {
        const jointPos = this.skeleton.getWorldPosition(mould.parentJointId);
        endPoint = [
          jointPos[0] + offset[0] + mould.endPoint[0],
          jointPos[1] + offset[1] + mould.endPoint[1],
          jointPos[2] + offset[2] + mould.endPoint[2],
        ];
      }

      return capsuleSDF(point, center, endPoint, mould.radius);
    }

    // Default to sphere
    return sphereSDF(point, center, mould.radius);
  }

  /**
   * Evaluate combined SDF at a point
   * All moulds are blended together using smooth minimum
   * Uses world positions when skeleton is attached
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
