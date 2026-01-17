import * as THREE from "three";
import type { Skeleton } from "../../../morphing/skeleton";

export const createSkeletonVisualization = (
  scene: THREE.Scene,
  skeleton: Skeleton,
  selectedJointId: string | null,
  showSkeleton: boolean,
  sceneMesh?: THREE.Mesh,
  existingGroup?: THREE.Group,
  existingJointSpheres?: Map<string, THREE.Mesh>
): { group: THREE.Group; jointSpheres: Map<string, THREE.Mesh> } => {
  // Remove existing skeleton visualization
  if (existingGroup) {
    if (existingGroup.parent) {
      existingGroup.parent.remove(existingGroup);
    }
    existingGroup.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  // Create new group for skeleton
  const skeletonGroup = new THREE.Group();
  const jointSpheres = new Map<string, THREE.Mesh>();

  // Materials
  const boneMaterial = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    linewidth: 2,
  });
  const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const selectedJointMaterial = new THREE.MeshBasicMaterial({
    color: 0xff00ff,
  });
  const jointGeometry = new THREE.SphereGeometry(0.03, 8, 8);

  // Draw each joint as a sphere
  const joints = skeleton.getJoints();
  for (const joint of joints) {
    const worldPos = skeleton.getWorldPosition(joint.id);

    // Create joint sphere
    const isSelected = joint.id === selectedJointId;
    const sphere = new THREE.Mesh(
      jointGeometry,
      isSelected ? selectedJointMaterial : jointMaterial
    );
    sphere.position.set(worldPos[0], worldPos[1], worldPos[2]);
    sphere.userData = { jointId: joint.id }; // Store joint ID for selection
    skeletonGroup.add(sphere);
    jointSpheres.set(joint.id, sphere);

    // Draw bone line to parent
    if (joint.parentId) {
      const parentPos = skeleton.getWorldPosition(joint.parentId);
      const points = [
        new THREE.Vector3(parentPos[0], parentPos[1], parentPos[2]),
        new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2]),
      ];
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(lineGeometry, boneMaterial);
      skeletonGroup.add(line);
    }
  }

  skeletonGroup.visible = showSkeleton;

  // Add skeleton as child of mesh so it rotates together
  if (sceneMesh) {
    sceneMesh.add(skeletonGroup);
  } else {
    scene.add(skeletonGroup);
  }

  return { group: skeletonGroup, jointSpheres };
};

export const updateSkeletonSelection = (
  jointSpheres: Map<string, THREE.Mesh>,
  selectedJointId: string | null
) => {
  const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const selectedJointMaterial = new THREE.MeshBasicMaterial({
    color: 0xff00ff,
  });

  for (const [jointId, sphere] of jointSpheres) {
    const oldMaterial = sphere.material as THREE.Material;
    oldMaterial.dispose();
    sphere.material = jointId === selectedJointId ? selectedJointMaterial : jointMaterial;
  }
};
