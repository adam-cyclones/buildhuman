// Skeleton: Hierarchical bone system with parent-relative transforms
// Each joint defines a bone frame with translation and rotation

import type { Joint, Vec3, Quat, Mat4 } from "./types";
import {
  identityMat4,
  composeMat4,
  multiplyMat4,
  getTranslation,
  transformPoint,
} from "./transform";

export class Skeleton {
  private joints: Map<string, Joint> = new Map();
  // Cache world transforms to avoid recalculation
  private worldTransformCache: Map<string, Mat4> = new Map();
  private cacheValid: boolean = false;

  /**
   * Add a joint to the skeleton
   */
  addJoint(joint: Joint): void {
    this.joints.set(joint.id, joint);
    this.invalidateCache();
  }

  /**
   * Get a joint by ID
   */
  getJoint(id: string): Joint | undefined {
    return this.joints.get(id);
  }

  /**
   * Get all joints
   */
  getJoints(): Joint[] {
    return Array.from(this.joints.values());
  }

  /**
   * Get root joints (joints with no parent)
   */
  getRootJoints(): Joint[] {
    return this.getJoints().filter((j) => !j.parentId);
  }

  /**
   * Update a joint's local offset (translation)
   */
  setJointLocalOffset(jointId: string, offset: Vec3): void {
    const joint = this.joints.get(jointId);
    if (joint) {
      joint.localOffset = offset;
      this.invalidateCache();
    }
  }

  /**
   * Move a joint by an offset (relative movement in local space)
   */
  moveJoint(jointId: string, offset: Vec3): void {
    const joint = this.joints.get(jointId);
    if (joint) {
      joint.localOffset = [
        joint.localOffset[0] + offset[0],
        joint.localOffset[1] + offset[1],
        joint.localOffset[2] + offset[2],
      ];
      this.invalidateCache();
    }
  }

  /**
   * Set a joint's local rotation
   */
  setJointLocalRotation(jointId: string, rotation: Quat): void {
    const joint = this.joints.get(jointId);
    if (joint) {
      joint.localRotation = rotation;
      this.invalidateCache();
    }
  }

  /**
   * Get world transformation matrix for a joint
   * This accounts for all parent transforms in the hierarchy
   */
  getWorldTransform(jointId: string): Mat4 {
    if (this.cacheValid && this.worldTransformCache.has(jointId)) {
      return this.worldTransformCache.get(jointId)!;
    }

    const joint = this.joints.get(jointId);
    if (!joint) {
      return identityMat4();
    }

    // Build local transform from translation and rotation
    const localTransform = composeMat4(joint.localOffset, joint.localRotation);

    // If no parent, local transform IS world transform
    if (!joint.parentId) {
      this.worldTransformCache.set(jointId, localTransform);
      return localTransform;
    }

    // Otherwise, world = parent_world * local
    const parentWorld = this.getWorldTransform(joint.parentId);
    const worldTransform = multiplyMat4(parentWorld, localTransform);
    this.worldTransformCache.set(jointId, worldTransform);

    return worldTransform;
  }

  /**
   * Get world position of a joint (convenience method)
   */
  getWorldPosition(jointId: string): Vec3 {
    const transform = this.getWorldTransform(jointId);
    return getTranslation(transform);
  }

  /**
   * Transform a point from bone-local space to world space
   */
  transformToWorld(jointId: string, localPoint: Vec3): Vec3 {
    const transform = this.getWorldTransform(jointId);
    return transformPoint(localPoint, transform);
  }

  /**
   * Clear all joints
   */
  clear(): void {
    this.joints.clear();
    this.invalidateCache();
  }

  /**
   * Invalidate cached world transforms (call after any modification)
   */
  private invalidateCache(): void {
    this.cacheValid = false;
    this.worldTransformCache.clear();
  }

  /**
   * Rebuild cache for all joints (optional optimization)
   */
  rebuildCache(): void {
    this.worldTransformCache.clear();
    for (const joint of this.joints.values()) {
      this.getWorldTransform(joint.id);
    }
    this.cacheValid = true;
  }
}
