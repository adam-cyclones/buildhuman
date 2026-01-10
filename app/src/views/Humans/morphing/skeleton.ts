// Simple skeleton system: transform graph for mould positioning

import type { Joint, Vec3 } from "./types";

export class Skeleton {
  private joints: Map<string, Joint> = new Map();

  /**
   * Add a joint to the skeleton
   */
  addJoint(joint: Joint): void {
    this.joints.set(joint.id, joint);

    // Update parent's children array if this joint has a parent
    if (joint.parentId) {
      const parent = this.joints.get(joint.parentId);
      if (parent && !parent.children.includes(joint.id)) {
        parent.children.push(joint.id);
      }
    }
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
   * Update a joint's local position
   */
  setJointPosition(jointId: string, position: Vec3): void {
    const joint = this.joints.get(jointId);
    if (joint) {
      joint.position = position;
    }
  }

  /**
   * Move a joint by an offset (relative movement)
   */
  moveJoint(jointId: string, offset: Vec3): void {
    const joint = this.joints.get(jointId);
    if (joint) {
      joint.position = [
        joint.position[0] + offset[0],
        joint.position[1] + offset[1],
        joint.position[2] + offset[2],
      ];
    }
  }

  /**
   * Get world position of a joint (accounting for parent transforms)
   */
  getWorldPosition(jointId: string): Vec3 {
    const joint = this.joints.get(jointId);
    if (!joint) {
      return [0, 0, 0];
    }

    // If no parent, joint position is already world position
    if (!joint.parentId) {
      return [...joint.position];
    }

    // Recursively add parent positions
    const parentPos = this.getWorldPosition(joint.parentId);
    return [
      parentPos[0] + joint.position[0],
      parentPos[1] + joint.position[1],
      parentPos[2] + joint.position[2],
    ];
  }

  /**
   * Clear all joints
   */
  clear(): void {
    this.joints.clear();
  }
}
