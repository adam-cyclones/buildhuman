import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";

export const createProfileRingsVisualization = async (
  scene: THREE.Scene,
  showSkeleton: boolean,
  sceneMesh?: THREE.Mesh,
  existingGroup?: THREE.Group
): Promise<THREE.Group | undefined> => {
  // Remove existing profile rings visualization
  if (existingGroup) {
    if (existingGroup.parent) {
      existingGroup.parent.remove(existingGroup);
    }
    existingGroup.traverse((child) => {
      if (child instanceof THREE.Line || child instanceof THREE.LineLoop) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  // Get control points from Rust (guaranteed to match SDF calculation)
  let controlPoints;
  try {
    controlPoints = await invoke<Array<{
      mouldId: string;
      segmentIndex: number;
      pointIndex: number;
      position: { x: number; y: number; z: number };
    }>>("get_profile_control_points");
  } catch (e) {
    console.error("Failed to get control points from Rust:", e);
    return undefined;
  }

  // Create new group for profile rings
  const profileRingsGroup = new THREE.Group();

  // Material for profile rings (yellow)
  const ringMaterial = new THREE.LineBasicMaterial({
    color: 0xffff00,
    linewidth: 1,
  });

  // Group points by mould and segment
  const pointsByMouldAndSegment = new Map<string, Map<number, Array<THREE.Vector3>>>();

  for (const cp of controlPoints) {
    const key = cp.mouldId;
    if (!pointsByMouldAndSegment.has(key)) {
      pointsByMouldAndSegment.set(key, new Map());
    }
    const mouldMap = pointsByMouldAndSegment.get(key)!;

    if (!mouldMap.has(cp.segmentIndex)) {
      mouldMap.set(cp.segmentIndex, []);
    }
    const points = mouldMap.get(cp.segmentIndex)!;
    points.push(new THREE.Vector3(cp.position.x, cp.position.y, cp.position.z));
  }

  // Draw rings for each segment (control points from Rust)
  for (const [_mouldId, segmentMap] of pointsByMouldAndSegment) {
    for (const [_segmentIdx, points] of segmentMap) {
      if (points.length < 3) continue; // Need at least 3 points for a ring

      // Create line loop for this ring (control points)
      const ringGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const ringLine = new THREE.LineLoop(ringGeometry, ringMaterial);
      profileRingsGroup.add(ringLine);
    }
  }

  profileRingsGroup.visible = showSkeleton; // Show/hide with skeleton

  // Add rings as child of mesh so they rotate together
  if (sceneMesh) {
    sceneMesh.add(profileRingsGroup);
  } else {
    scene.add(profileRingsGroup);
  }

  return profileRingsGroup;
};
