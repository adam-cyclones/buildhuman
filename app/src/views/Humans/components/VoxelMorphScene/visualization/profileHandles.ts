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
  tangentHandles?: {
    inHandle: THREE.Mesh;
    outHandle: THREE.Mesh;
    inLine: THREE.Line;
    outLine: THREE.Line;
  };
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
  const handleGeometry = new THREE.SphereGeometry(0.02, 16, 16); // Larger for easier clicking
  const handleMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    depthTest: false, // Render on top of everything
    transparent: true,
    opacity: 0.9
  });

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
  const worldStart = skeleton.transformToWorld(mould.parentJointId, mould.center);
  const worldEnd = skeleton.transformToWorld(mould.parentJointId, mould.endPoint);

  // Interpolate to segment position (t from 0 to 1)
  const numSegments = mould.radialProfiles.length;
  const t = segmentIndex / (numSegments - 1);

  const ringCenter = new THREE.Vector3(
    worldStart[0] + t * (worldEnd[0] - worldStart[0]),
    worldStart[1] + t * (worldEnd[1] - worldStart[1]),
    worldStart[2] + t * (worldEnd[2] - worldStart[2])
  );

  const boneDirection = new THREE.Vector3(
    worldEnd[0] - worldStart[0],
    worldEnd[1] - worldStart[1],
    worldEnd[2] - worldStart[2]
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

/**
 * Creates tangent handles for bezier curve editing on a selected control point
 * Shows "in" and "out" handles connected to the control point
 */
export function createTangentHandles(
  handle: ProfileHandle,
  group: THREE.Group,
  mouldManager: MouldManager
): void {
  // Remove existing tangent handles if any
  if (handle.tangentHandles) {
    group.remove(handle.tangentHandles.inLine);
    group.remove(handle.tangentHandles.outLine);
    group.remove(handle.tangentHandles.inHandle);
    group.remove(handle.tangentHandles.outHandle);
  }

  const mould = mouldManager.getMould(handle.mouldId);
  if (!mould || !mould.radialProfiles) return;

  const profile = mould.radialProfiles[handle.segmentIndex];
  const numPoints = profile.length;
  const i = handle.controlPointIndex;

  // Get adjacent control points for calculating tangent direction
  const prevIndex = (i - 1 + numPoints) % numPoints;
  const nextIndex = (i + 1) % numPoints;

  const userData = handle.mesh.userData;
  const ringCenter = userData.ringCenter as THREE.Vector3;
  const basis = userData.basis as { u: THREE.Vector3; v: THREE.Vector3 };

  // Calculate positions of previous and next control points
  const prevAngle = (prevIndex / numPoints) * Math.PI * 2;
  const nextAngle = (nextIndex / numPoints) * Math.PI * 2;
  const prevRadius = profile[prevIndex];
  const nextRadius = profile[nextIndex];

  const prevU = prevRadius * Math.cos(prevAngle);
  const prevV = prevRadius * Math.sin(prevAngle);
  const nextU = nextRadius * Math.cos(nextAngle);
  const nextV = nextRadius * Math.sin(nextAngle);

  // Current point position in 2D
  const currentAngle = userData.angle as number;
  const currentU = handle.radius * Math.cos(currentAngle);
  const currentV = handle.radius * Math.sin(currentAngle);

  // Calculate tangent direction (simplified - just use vector to prev/next)
  const tangentU = (nextU - prevU) / 6;
  const tangentV = (nextV - prevV) / 6;

  // In handle: point - tangent
  const inU = currentU - tangentU;
  const inV = currentV - tangentV;
  const inPos = new THREE.Vector3(
    ringCenter.x + inU * basis.u.x + inV * basis.v.x,
    ringCenter.y + inU * basis.u.y + inV * basis.v.y,
    ringCenter.z + inU * basis.u.z + inV * basis.v.z
  );

  // Out handle: point + tangent
  const outU = currentU + tangentU;
  const outV = currentV + tangentV;
  const outPos = new THREE.Vector3(
    ringCenter.x + outU * basis.u.x + outV * basis.v.x,
    ringCenter.y + outU * basis.u.y + outV * basis.v.y,
    ringCenter.z + outU * basis.u.z + outV * basis.v.z
  );

  // Create small spheres for the tangent handle endpoints
  const handleGeometry = new THREE.SphereGeometry(0.008, 8, 8);
  const handleMaterial = new THREE.MeshBasicMaterial({
    color: 0x888888,
    depthTest: false,
    transparent: true,
    opacity: 0.8
  });

  const inHandle = new THREE.Mesh(handleGeometry, handleMaterial.clone());
  inHandle.position.copy(inPos);
  inHandle.userData = {
    type: "tangent-handle",
    direction: "in",
    parentHandle: handle
  };

  const outHandle = new THREE.Mesh(handleGeometry, handleMaterial.clone());
  outHandle.position.copy(outPos);
  outHandle.userData = {
    type: "tangent-handle",
    direction: "out",
    parentHandle: handle
  };

  // Create lines connecting control point to tangent handles
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x888888,
    depthTest: false,
    transparent: true,
    opacity: 0.6
  });

  const inLineGeometry = new THREE.BufferGeometry().setFromPoints([
    handle.mesh.position,
    inPos
  ]);
  const inLine = new THREE.Line(inLineGeometry, lineMaterial.clone());

  const outLineGeometry = new THREE.BufferGeometry().setFromPoints([
    handle.mesh.position,
    outPos
  ]);
  const outLine = new THREE.Line(outLineGeometry, lineMaterial.clone());

  // Add to scene
  group.add(inHandle);
  group.add(outHandle);
  group.add(inLine);
  group.add(outLine);

  // Store references
  handle.tangentHandles = {
    inHandle,
    outHandle,
    inLine,
    outLine
  };
}

/**
 * Removes tangent handles from a control point
 */
export function removeTangentHandles(
  handle: ProfileHandle,
  group: THREE.Group
): void {
  if (handle.tangentHandles) {
    group.remove(handle.tangentHandles.inLine);
    group.remove(handle.tangentHandles.outLine);
    group.remove(handle.tangentHandles.inHandle);
    group.remove(handle.tangentHandles.outHandle);
    handle.tangentHandles = undefined;
  }
}
