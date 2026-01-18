import * as THREE from "three";
import type { ProfileHandle } from "../visualization/profileHandles";
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
 * 1. Click handle to select it
 * 2. Press 'g' or click selected handle again to enter move mode
 * 3. Move mouse to adjust radius
 * 4. Click to confirm, or press Escape to cancel
 *
 * @param getCamera - Function to get current camera
 * @param getHandles - Function to get current profile handles
 * @param getMouldManager - Function to get mould manager
 * @param onRadiusChange - Callback when radius changes (for live updates)
 * @returns Event handlers for mouse and keyboard events
 */
export function createProfileDragHandler(
  getCamera: () => THREE.Camera | undefined,
  getHandles: () => ProfileHandle[],
  getMouldManager: () => MouldManager | undefined,
  onRadiusChange: (mouldId: string, segmentIndex: number, controlPointIndex: number, newRadius: number) => void
) {
  const editState: EditState = {
    isMoving: false,
    selectedHandle: null,
    plane: null,
    startRadius: 0,
  };

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.02 };

  /**
   * Handle mouse click - select handle or confirm move
   */
  function handleClick(event: MouseEvent, canvas: HTMLCanvasElement) {
    const camera = getCamera();
    const handles = getHandles();
    if (!camera || handles.length === 0) return;

    // Calculate mouse position in normalized device coordinates
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    if (editState.isMoving) {
      // Click while moving - confirm the change
      confirmMove();
      return;
    }

    // Raycast against handle meshes
    raycaster.setFromCamera(mouse, camera);
    const handleMeshes = handles.map(h => h.mesh);
    const intersects = raycaster.intersectObjects(handleMeshes);

    if (intersects.length > 0) {
      const intersected = intersects[0].object as THREE.Mesh;
      const userData = intersected.userData;

      if (userData.type === "profile-handle") {
        // Find the handle
        const handle = handles.find(
          h =>
            h.mouldId === userData.mouldId &&
            h.segmentIndex === userData.segmentIndex &&
            h.controlPointIndex === userData.controlPointIndex
        );

        if (handle) {
          if (editState.selectedHandle === handle) {
            // Clicking selected handle again - enter move mode
            enterMoveMode(handle, camera);
          } else {
            // Select new handle
            selectHandle(handle);
          }
        }
      }
      event.stopPropagation();
      event.preventDefault();
    } else {
      // Click on empty space - deselect
      deselectHandle();
    }
  }

  /**
   * Select a handle
   */
  function selectHandle(handle: ProfileHandle) {
    // Deselect previous
    if (editState.selectedHandle) {
      (editState.selectedHandle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00);
    }

    // Select new
    editState.selectedHandle = handle;
    editState.startRadius = handle.radius;
    (handle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xffff00); // Yellow for selected
  }

  /**
   * Deselect current handle
   */
  function deselectHandle() {
    if (editState.selectedHandle) {
      (editState.selectedHandle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00);
      editState.selectedHandle = null;
    }
  }

  /**
   * Enter move mode for selected handle
   */
  function enterMoveMode(handle: ProfileHandle, camera: THREE.Camera) {
    editState.isMoving = true;
    editState.selectedHandle = handle;
    editState.startRadius = handle.radius;

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
    if (editState.selectedHandle) {
      // Keep it selected (yellow) but stop moving
      (editState.selectedHandle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xffff00);
    }
    editState.isMoving = false;
    editState.plane = null;
  }

  /**
   * Cancel move and restore original radius
   */
  function cancelMove() {
    if (!editState.isMoving || !editState.selectedHandle) return;

    const handle = editState.selectedHandle;
    const mouldManager = getMouldManager();

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

      // Calculate new radius (distance from ring center to intersection point)
      const delta = intersectPoint.clone().sub(ringCenter);
      const newRadius = delta.length();

      // Clamp radius to reasonable bounds
      const minRadius = 0.005;
      const maxRadius = 0.2;
      const clampedRadius = Math.max(minRadius, Math.min(maxRadius, newRadius));

      // Update handle position along its angle
      const angle = userData.angle as number;
      const handlePos = new THREE.Vector3(
        ringCenter.x + clampedRadius * (Math.cos(angle) * basis.u.x + Math.sin(angle) * basis.v.x),
        ringCenter.y + clampedRadius * (Math.cos(angle) * basis.u.y + Math.sin(angle) * basis.v.y),
        ringCenter.z + clampedRadius * (Math.cos(angle) * basis.u.z + Math.sin(angle) * basis.v.z)
      );

      editState.selectedHandle.mesh.position.copy(handlePos);
      editState.selectedHandle.radius = clampedRadius;

      // Notify about radius change
      onRadiusChange(
        editState.selectedHandle.mouldId,
        editState.selectedHandle.segmentIndex,
        editState.selectedHandle.controlPointIndex,
        clampedRadius
      );
    }
  }

  /**
   * Handle keyboard shortcuts
   */
  function handleKeyDown(event: KeyboardEvent) {
    // 'g' key - enter move mode if handle is selected
    if (event.key === 'g' || event.key === 'G') {
      if (editState.selectedHandle && !editState.isMoving) {
        const camera = getCamera();
        if (camera) {
          enterMoveMode(editState.selectedHandle, camera);
          event.preventDefault();
        }
      }
    }

    // Escape - cancel move
    if (event.key === 'Escape') {
      if (editState.isMoving) {
        cancelMove();
        event.preventDefault();
      }
    }
  }

  return {
    handleClick,
    handleMouseMove,
    handleKeyDown,
    // Expose state for external access if needed
    getEditState: () => editState,
  };
}
