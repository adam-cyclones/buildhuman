// Debug visualization utilities for skeleton system

import * as THREE from "three";
import type { Skeleton } from "./skeleton";

/**
 * Create debug visualization mesh for skeleton joints
 * Renders small spheres at each joint position
 */
export function createSkeletonDebugMesh(skeleton: Skeleton): THREE.Group {
  const group = new THREE.Group();

  // Create material for joint spheres
  const jointMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    wireframe: false,
  });

  const jointGeometry = new THREE.SphereGeometry(0.05, 8, 8);

  // Add sphere for each joint
  const joints = skeleton.getJoints();
  for (const joint of joints) {
    const worldPos = skeleton.getWorldPosition(joint.id);
    const sphere = new THREE.Mesh(jointGeometry, jointMaterial);
    sphere.position.set(worldPos[0], worldPos[1], worldPos[2]);
    sphere.name = `joint-${joint.id}`;
    group.add(sphere);
  }

  // Create lines connecting parent-child relationships
  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });

  for (const joint of joints) {
    if (joint.parentId) {
      const childPos = skeleton.getWorldPosition(joint.id);
      const parentPos = skeleton.getWorldPosition(joint.parentId);

      const points = [
        new THREE.Vector3(parentPos[0], parentPos[1], parentPos[2]),
        new THREE.Vector3(childPos[0], childPos[1], childPos[2]),
      ];

      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(lineGeometry, lineMaterial);
      line.name = `bone-${joint.parentId}-${joint.id}`;
      group.add(line);
    }
  }

  group.name = "skeleton-debug";
  return group;
}

/**
 * Update existing debug mesh with new skeleton state
 */
export function updateSkeletonDebugMesh(
  debugGroup: THREE.Group,
  skeleton: Skeleton
): void {
  // Remove all existing children
  while (debugGroup.children.length > 0) {
    const child = debugGroup.children[0];
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
    }
    debugGroup.remove(child);
  }

  // Recreate visualization
  const newMesh = createSkeletonDebugMesh(skeleton);
  while (newMesh.children.length > 0) {
    debugGroup.add(newMesh.children[0]);
  }
}
