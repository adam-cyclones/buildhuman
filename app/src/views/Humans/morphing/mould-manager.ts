// MouldManager: Manages moulds attached to skeleton joints
// Moulds are defined in bone-local space and synced to Rust for GPU rendering

import type { Mould } from "./types";

export class MouldManager {
  private moulds: Map<string, Mould> = new Map();

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
   * Update a mould's radius
   */
  updateMouldRadius(id: string, radius: number): void {
    const mould = this.moulds.get(id);
    if (mould) {
      mould.radius = radius;
    }
  }

  /**
   * Get all moulds attached to a specific joint
   */
  getMouldsByJoint(jointId: string): Mould[] {
    return Array.from(this.moulds.values()).filter(
      m => m.parentJointId === jointId
    );
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
   * Update a single radial handle's radius (in-place, then replace array for reactivity)
   */
  updateHandleRadius(mouldId: string, segIdx: number, ptIdx: number, radius: number): void {
    const mould = this.moulds.get(mouldId);
    if (!mould?.radialProfiles) return;
    const newProfiles = mould.radialProfiles.map((ring, si) =>
      si === segIdx ? ring.map((r, pi) => pi === ptIdx ? Math.max(0.005, radius) : r) : ring
    );
    mould.radialProfiles = newProfiles;
  }

  /**
   * Insert a new ring after afterIdx (clones that ring). Rings are evenly distributed implicitly.
   */
  addRing(mouldId: string, afterIdx: number): void {
    const mould = this.moulds.get(mouldId);
    if (!mould?.radialProfiles) return;
    const source = mould.radialProfiles[afterIdx] ?? mould.radialProfiles[mould.radialProfiles.length - 1];
    const newProfiles = [...mould.radialProfiles];
    newProfiles.splice(afterIdx + 1, 0, [...source]);
    mould.radialProfiles = newProfiles;
  }

  /**
   * Remove the ring at segIdx. Minimum 1 ring is enforced.
   */
  removeRing(mouldId: string, segIdx: number): void {
    const mould = this.moulds.get(mouldId);
    if (!mould?.radialProfiles || mould.radialProfiles.length <= 1) return;
    const newProfiles = [...mould.radialProfiles];
    newProfiles.splice(segIdx, 1);
    mould.radialProfiles = newProfiles;
  }

  /**
   * Insert a new handle between afterPtIdx and the next handle (interpolated radius).
   */
  addHandle(mouldId: string, segIdx: number, afterPtIdx: number): void {
    const mould = this.moulds.get(mouldId);
    if (!mould?.radialProfiles) return;
    const ring = [...mould.radialProfiles[segIdx]];
    const n = ring.length;
    const nextIdx = (afterPtIdx + 1) % n;
    const newRadius = (ring[afterPtIdx] + ring[nextIdx]) / 2;
    ring.splice(afterPtIdx + 1, 0, newRadius);
    const newProfiles = mould.radialProfiles.map((r, si) => si === segIdx ? ring : r);
    mould.radialProfiles = newProfiles;
  }

  /**
   * Remove handle at ptIdx. Minimum 3 handles per ring enforced.
   */
  removeHandle(mouldId: string, segIdx: number, ptIdx: number): void {
    const mould = this.moulds.get(mouldId);
    if (!mould?.radialProfiles) return;
    const ring = mould.radialProfiles[segIdx];
    if (ring.length <= 3) return;
    const newRing = ring.filter((_, i) => i !== ptIdx);
    const newProfiles = mould.radialProfiles.map((r, si) => si === segIdx ? newRing : r);
    mould.radialProfiles = newProfiles;
  }
}
