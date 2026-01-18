import * as THREE from "three";
import type { MouldManager } from "../../../morphing/mould-manager";
import type { Skeleton } from "../../../morphing/skeleton";

/**
 * Represents a draggable handle for editing profile ring control points
 */
export type ProfileHandle = {
  mesh: THREE.Mesh;
  mouldId: string;
  segmentIndex: number;
  controlPointIndex: number;
  radius: number;
};

/**
 * Creates visual handles for editing a profiled capsule's radial profiles
 *
 * @param scene - The THREE.js scene to add handles to
 * @param mouldId - ID of the mould to edit
 * @param segmentIndex - Index of the profile ring segment (0-5)
 * @param mouldManager - The mould manager instance
 * @param skeleton - The skeleton instance
 * @returns Group containing all handles and array of handle metadata
 */
export function createProfileHandles(
  scene: THREE.Scene,
  mouldId: string,
  segmentIndex: number,
  mouldManager: MouldManager,
  skeleton: Skeleton
): { group: THREE.Group; handles: ProfileHandle[] } {
  const group = new THREE.Group();
  const handles: ProfileHandle[] = [];

  const mould = mouldManager.getMould(mouldId);
  if (!mould || mould.shape !== "profiled-capsule" || !mould.radialProfiles) {
    return { group, handles };
  }

  const profiles = mould.radialProfiles;
  if (segmentIndex < 0 || segmentIndex >= profiles.length) {
    return { group, handles };
  }

  const profile = profiles[segmentIndex];
  const numControlPoints = profile.length;

  // Get world-space position of the capsule at this segment
  const { ringCenter, boneDirection } = getSegmentWorldPosition(
    mould,
    segmentIndex,
    skeleton
  );

  if (!ringCenter || !boneDirection) {
    return { group, handles };
  }

  // Create orthonormal basis for the ring (perpendicular to bone direction)
  const basis = createRingBasis(boneDirection);

  // Create a handle for each control point around the ring
  const handleGeometry = new THREE.SphereGeometry(0.008, 8, 8);
  const handleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

  for (let i = 0; i < numControlPoints; i++) {
    const angle = (i / numControlPoints) * Math.PI * 2;
    const radius = profile[i];

    // Calculate handle position in world space
    const handlePos = new THREE.Vector3(
      ringCenter.x + radius * (Math.cos(angle) * basis.u.x + Math.sin(angle) * basis.v.x),
      ringCenter.y + radius * (Math.cos(angle) * basis.u.y + Math.sin(angle) * basis.v.y),
      ringCenter.z + radius * (Math.cos(angle) * basis.u.z + Math.sin(angle) * basis.v.z)
    );

    const handleMesh = new THREE.Mesh(handleGeometry, handleMaterial.clone());
    handleMesh.position.copy(handlePos);

    // Store metadata for raycasting and editing
    handleMesh.userData = {
      type: "profile-handle",
      mouldId,
      segmentIndex,
      controlPointIndex: i,
      ringCenter,
      basis,
      angle,
    };

    group.add(handleMesh);
    handles.push({
      mesh: handleMesh,
      mouldId,
      segmentIndex,
      controlPointIndex: i,
      radius,
    });
  }

  scene.add(group);
  return { group, handles };
}

/**
 * Gets the world-space position of a profile ring segment
 */
function getSegmentWorldPosition(
  mould: any,
  segmentIndex: number,
  skeleton: Skeleton
): { ringCenter: THREE.Vector3 | null; boneDirection: THREE.Vector3 | null } {
  if (!mould.parentJointId || !mould.endPoint) {
    return { ringCenter: null, boneDirection: null };
  }

  const joint = skeleton.getJoint(mould.parentJointId);
  if (!joint) {
    return { ringCenter: null, boneDirection: null };
  }

  // Get world positions of capsule start and end
  const worldStart = skeleton.transformPointToWorld(mould.parentJointId, mould.center);
  const worldEnd = skeleton.transformPointToWorld(mould.parentJointId, mould.endPoint);

  // Interpolate to segment position (t from 0 to 1)
  const numSegments = mould.radialProfiles.length;
  const t = segmentIndex / (numSegments - 1);

  const ringCenter = new THREE.Vector3(
    worldStart.x + t * (worldEnd.x - worldStart.x),
    worldStart.y + t * (worldEnd.y - worldStart.y),
    worldStart.z + t * (worldEnd.z - worldStart.z)
  );

  const boneDirection = new THREE.Vector3(
    worldEnd.x - worldStart.x,
    worldEnd.y - worldStart.y,
    worldEnd.z - worldStart.z
  ).normalize();

  return { ringCenter, boneDirection };
}

/**
 * Creates an orthonormal basis perpendicular to the bone direction
 */
function createRingBasis(boneDir: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3 } {
  // Choose a reference vector (prefer Y-up if bone isn't aligned with Y)
  const worldUp = new THREE.Vector3(0, 1, 0);
  const threshold = 0.99;

  let reference: THREE.Vector3;
  if (Math.abs(boneDir.dot(worldUp)) > threshold) {
    // Bone is aligned with Y, use X as reference
    reference = new THREE.Vector3(1, 0, 0);
  } else {
    reference = worldUp;
  }

  // Create orthonormal basis using Gram-Schmidt
  const u = new THREE.Vector3().crossVectors(boneDir, reference).normalize();
  const v = new THREE.Vector3().crossVectors(boneDir, u).normalize();

  return { u, v };
}

/**
 * Updates handle positions when profile data changes
 */
export function updateProfileHandles(
  handles: ProfileHandle[],
  mouldManager: MouldManager,
  skeleton: Skeleton
): void {
  if (handles.length === 0) return;

  const mouldId = handles[0].mouldId;
  const segmentIndex = handles[0].segmentIndex;

  const mould = mouldManager.getMould(mouldId);
  if (!mould || !mould.radialProfiles) return;

  const profile = mould.radialProfiles[segmentIndex];
  const { ringCenter, boneDirection } = getSegmentWorldPosition(mould, segmentIndex, skeleton);

  if (!ringCenter || !boneDirection) return;

  const basis = createRingBasis(boneDirection);
  const numControlPoints = profile.length;

  handles.forEach((handle, i) => {
    const angle = (i / numControlPoints) * Math.PI * 2;
    const radius = profile[i];

    const handlePos = new THREE.Vector3(
      ringCenter.x + radius * (Math.cos(angle) * basis.u.x + Math.sin(angle) * basis.v.x),
      ringCenter.y + radius * (Math.cos(angle) * basis.u.y + Math.sin(angle) * basis.v.y),
      ringCenter.z + radius * (Math.cos(angle) * basis.u.z + Math.sin(angle) * basis.v.z)
    );

    handle.mesh.position.copy(handlePos);
    handle.radius = radius;

    // Update userData
    handle.mesh.userData.ringCenter = ringCenter;
    handle.mesh.userData.basis = basis;
    handle.mesh.userData.angle = angle;
  });
}
