import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ProfileHandle } from "../visualization/profileHandles";
import { createTangentHandles, removeTangentHandles } from "../visualization/profileHandles";
import type { MouldManager } from "../../../morphing/mould-manager";

/**
 * State for profile handle editing
 */
type EditState = {
  isMoving: boolean;
  selectedHandle: ProfileHandle | null;
  plane: THREE.Plane | null;
  startRadius: number;
};

/**
 * Creates a profile handle interaction handler with click-to-move workflow
 *
 * Workflow:
 * 1. Click handle to select it (shows tangent handles)
 * 2. Press 'g' to enter move mode
 * 3. Move mouse to adjust position
 * 4. Click to confirm, or press Escape to cancel
 *
 * Camera rotation is automatically disabled during move mode.
 *
 * @param getCamera - Function to get current camera
 * @param getHandles - Function to get current profile handles
 * @param getMouldManager - Function to get mould manager
 * @param getControls - Function to get OrbitControls (to disable during drag)
 * @param getHandlesGroup - Function to get the THREE.Group containing handles (for tangent handles)
 * @param onRadiusChange - Callback when radius changes (for live updates)
 * @returns Event handlers for mouse and keyboard events
 */
export function createProfileDragHandler(
  getCamera: () => THREE.Camera | undefined,
  getHandles: () => ProfileHandle[],
  getMouldManager: () => MouldManager | undefined,
  getControls: () => OrbitControls | undefined,
  getHandlesGroup: () => THREE.Group | undefined,
  onRadiusChange: (mouldId: string, segmentIndex: number, controlPointIndex: number, newRadius: number) => void
) {
  const editState: EditState = {
    isMoving: false,
    selectedHandle: null,
    plane: null,
    startRadius: 0,
  };

  const raycaster = new THREE.Raycaster();
  // Increase threshold for easier clicking on sphere handles
  raycaster.params.Points = { threshold: 0.05 };

  /**
   * Handle mouse click - select handle or confirm move
   */
  function handleClick(event: MouseEvent, canvas: HTMLCanvasElement) {
    const camera = getCamera();
    const handles = getHandles();

    console.log("Profile drag handleClick:", {
      hasCamera: !!camera,
      handlesCount: handles.length,
      isMoving: editState.isMoving
    });

    if (!camera || handles.length === 0) return;

    // Calculate mouse position in normalized device coordinates
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    if (editState.isMoving) {
      // Click while moving - confirm the change
      console.log("Confirming move");
      confirmMove();
      return;
    }

    // Raycast against handle meshes
    raycaster.setFromCamera(mouse, camera);
    const handleMeshes = handles.map(h => h.mesh);
    const intersects = raycaster.intersectObjects(handleMeshes);

    console.log("Handle raycast:", {
      intersectsCount: intersects.length,
      handlesCount: handleMeshes.length,
      mouse,
      handlePositions: handleMeshes.map(m => m.position)
    });

    if (intersects.length > 0) {
      const intersected = intersects[0].object as THREE.Mesh;
      const userData = intersected.userData;

      console.log("Intersected handle userData:", userData);

      if (userData.type === "profile-handle") {
        // Find the handle
        const handle = handles.find(
          h =>
            h.mouldId === userData.mouldId &&
            h.segmentIndex === userData.segmentIndex &&
            h.controlPointIndex === userData.controlPointIndex
        );

        if (handle) {
          // Select handle (press 'g' to move)
          console.log("Selecting handle");
          selectHandle(handle);
          event.stopPropagation();
          event.preventDefault();
        }
      }
    }
    // Don't deselect here - let other handlers (ring click, joint click) handle empty clicks
  }

  /**
   * Select a handle
   */
  function selectHandle(handle: ProfileHandle) {
    const group = getHandlesGroup();
    const mouldManager = getMouldManager();

    // Deselect previous (remove its tangent handles)
    if (editState.selectedHandle) {
      (editState.selectedHandle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00);
      if (group) {
        removeTangentHandles(editState.selectedHandle, group);
      }
    }

    // Select new
    editState.selectedHandle = handle;
    editState.startRadius = handle.radius;
    (handle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xffff00); // Yellow for selected

    // Create tangent handles for selected point
    if (group && mouldManager) {
      createTangentHandles(handle, group, mouldManager);
    }
  }

  /**
   * Deselect current handle
   */
  function deselectHandle() {
    if (editState.selectedHandle) {
      const group = getHandlesGroup();
      (editState.selectedHandle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00);

      // Remove tangent handles
      if (group) {
        removeTangentHandles(editState.selectedHandle, group);
      }

      editState.selectedHandle = null;
    }
  }

  /**
   * Update tangent handle positions when control point moves
   */
  function updateTangentHandlePositions(handle: ProfileHandle, mouldManager: MouldManager) {
    if (!handle.tangentHandles) return;

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

    // Calculate tangent direction
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

    // Update tangent handle positions
    handle.tangentHandles.inHandle.position.copy(inPos);
    handle.tangentHandles.outHandle.position.copy(outPos);

    // Update line geometries
    const inLineGeometry = new THREE.BufferGeometry().setFromPoints([
      handle.mesh.position,
      inPos
    ]);
    handle.tangentHandles.inLine.geometry.dispose();
    handle.tangentHandles.inLine.geometry = inLineGeometry;

    const outLineGeometry = new THREE.BufferGeometry().setFromPoints([
      handle.mesh.position,
      outPos
    ]);
    handle.tangentHandles.outLine.geometry.dispose();
    handle.tangentHandles.outLine.geometry = outLineGeometry;
  }

  /**
   * Enter move mode for selected handle
   */
  function enterMoveMode(handle: ProfileHandle, camera: THREE.Camera) {
    const controls = getControls();

    editState.isMoving = true;
    editState.selectedHandle = handle;
    editState.startRadius = handle.radius;

    // Disable OrbitControls during move mode
    if (controls) {
      controls.enabled = false;
    }

    // Create a plane perpendicular to camera view, passing through ring center
    const userData = handle.mesh.userData;
    const ringCenter = userData.ringCenter as THREE.Vector3;
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);

    editState.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      cameraDirection,
      ringCenter
    );

    // Change handle color to indicate move mode
    (handle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xff0000); // Red for moving
  }

  /**
   * Exit move mode and confirm changes
   */
  function confirmMove() {
    const controls = getControls();

    if (editState.selectedHandle) {
      // Keep it selected (yellow) but stop moving
      (editState.selectedHandle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xffff00);
    }
    editState.isMoving = false;
    editState.plane = null;

    // Re-enable OrbitControls
    if (controls) {
      controls.enabled = true;
    }
  }

  /**
   * Cancel move and restore original radius
   */
  function cancelMove() {
    if (!editState.isMoving || !editState.selectedHandle) return;

    const handle = editState.selectedHandle;
    const mouldManager = getMouldManager();
    const controls = getControls();

    if (mouldManager) {
      const mould = mouldManager.getMould(handle.mouldId);
      if (mould && mould.radialProfiles) {
        // Restore original radius
        mould.radialProfiles[handle.segmentIndex][handle.controlPointIndex] = editState.startRadius;

        // Notify about the restoration
        onRadiusChange(
          handle.mouldId,
          handle.segmentIndex,
          handle.controlPointIndex,
          editState.startRadius
        );
      }
    }

    // Reset to selected state
    (handle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xffff00);
    editState.isMoving = false;
    editState.plane = null;

    // Re-enable OrbitControls
    if (controls) {
      controls.enabled = true;
    }
  }

  /**
   * Handle mouse move - update handle position if in move mode
   */
  function handleMouseMove(event: MouseEvent, canvas: HTMLCanvasElement) {
    if (!editState.isMoving || !editState.selectedHandle || !editState.plane) return;

    const camera = getCamera();
    const mouldManager = getMouldManager();
    if (!camera || !mouldManager) return;

    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Raycast to find intersection with move plane
    raycaster.setFromCamera(mouse, camera);
    const intersectPoint = new THREE.Vector3();
    const intersected = raycaster.ray.intersectPlane(editState.plane, intersectPoint);

    if (intersected) {
      const userData = editState.selectedHandle.mesh.userData;
      const ringCenter = userData.ringCenter as THREE.Vector3;
      const basis = userData.basis as { u: THREE.Vector3; v: THREE.Vector3 };

      // Calculate delta in 3D world space
      const delta = intersectPoint.clone().sub(ringCenter);

      // Project delta onto the ring plane basis vectors to get 2D coordinates
      const u = basis.u;
      const v = basis.v;
      const deltaU = delta.dot(u); // Component along u axis
      const deltaV = delta.dot(v); // Component along v axis

      // Clamp to reasonable bounds in 2D
      const maxDistance = 0.2;
      const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

      let clampedU = deltaU;
      let clampedV = deltaV;

      if (distance > maxDistance) {
        // Scale down to max distance while preserving direction
        const scale = maxDistance / distance;
        clampedU = deltaU * scale;
        clampedV = deltaV * scale;
      }

      // Enforce minimum distance from center
      const minDistance = 0.005;
      const clampedDistance = Math.sqrt(clampedU * clampedU + clampedV * clampedV);
      if (clampedDistance < minDistance) {
        const scale = minDistance / clampedDistance;
        clampedU *= scale;
        clampedV *= scale;
      }

      // Convert back to 3D world position
      const handlePos = new THREE.Vector3(
        ringCenter.x + clampedU * u.x + clampedV * v.x,
        ringCenter.y + clampedU * u.y + clampedV * v.y,
        ringCenter.z + clampedU * u.z + clampedV * v.z
      );

      editState.selectedHandle.mesh.position.copy(handlePos);

      // Store both radius and angle for backward compatibility
      const newRadius = Math.sqrt(clampedU * clampedU + clampedV * clampedV);
      const newAngle = Math.atan2(clampedV, clampedU);
      editState.selectedHandle.radius = newRadius;

      // Update userData with new angle
      userData.angle = newAngle;

      // Update tangent handle positions if they exist
      if (editState.selectedHandle.tangentHandles) {
        updateTangentHandlePositions(editState.selectedHandle, mouldManager);
      }

      // Notify about radius change (this will need to be extended to support 2D coords)
      onRadiusChange(
        editState.selectedHandle.mouldId,
        editState.selectedHandle.segmentIndex,
        editState.selectedHandle.controlPointIndex,
        newRadius
      );
    }
  }

  /**
   * Handle keyboard shortcuts
   */
  function handleKeyDown(event: KeyboardEvent) {
    console.log("Profile drag keydown:", event.key, {
      selectedHandle: !!editState.selectedHandle,
      isMoving: editState.isMoving
    });

    // 'g' key - enter move mode if handle is selected
    if (event.key === 'g' || event.key === 'G') {
      console.log("G pressed, selectedHandle:", editState.selectedHandle);
      if (editState.selectedHandle && !editState.isMoving) {
        const camera = getCamera();
        if (camera) {
          console.log("Entering move mode");
          enterMoveMode(editState.selectedHandle, camera);
          event.preventDefault();
        }
      }
    }

    // Escape - cancel move
    if (event.key === 'Escape') {
      if (editState.isMoving) {
        console.log("Cancelling move");
        cancelMove();
        event.preventDefault();
      }
    }
  }

  return {
    handleClick,
    handleMouseMove,
    handleKeyDown,
    deselectHandle,
    // Expose state for external access if needed
    getEditState: () => editState,
  };
}
