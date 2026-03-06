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
}
