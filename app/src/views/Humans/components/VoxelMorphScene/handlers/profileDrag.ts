import * as THREE from "three";
import type { ProfileHandle } from "../visualization/profileHandles";
import type { MouldManager } from "../../../morphing/mould-manager";

/**
 * State for profile handle dragging
 */
type DragState = {
  isDragging: boolean;
  handle: ProfileHandle | null;
  plane: THREE.Plane | null;
  startRadius: number;
};

/**
 * Creates a profile handle drag handler
 *
 * @param getCamera - Function to get current camera
 * @param getHandles - Function to get current profile handles
 * @param getMouldManager - Function to get mould manager
 * @param onRadiusChange - Callback when radius changes (for live updates)
 * @returns Event handlers for mouse down, move, and up
 */
export function createProfileDragHandler(
  getCamera: () => THREE.Camera | undefined,
  getHandles: () => ProfileHandle[],
  getMouldManager: () => MouldManager | undefined,
  onRadiusChange: (mouldId: string, segmentIndex: number, controlPointIndex: number, newRadius: number) => void
) {
  const dragState: DragState = {
    isDragging: false,
    handle: null,
    plane: null,
    startRadius: 0,
  };

  const raycaster = new THREE.Raycaster();
  raycaster.params.Points = { threshold: 0.02 };

  /**
   * Handle mouse down - check if clicking on a handle
   */
  function handleMouseDown(event: MouseEvent, canvas: HTMLCanvasElement) {
    const camera = getCamera();
    const handles = getHandles();
    if (!camera || handles.length === 0) return;

    // Calculate mouse position in normalized device coordinates
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

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
          dragState.isDragging = true;
          dragState.handle = handle;
          dragState.startRadius = handle.radius;

          // Create a plane perpendicular to camera view, passing through ring center
          const ringCenter = userData.ringCenter as THREE.Vector3;
          const cameraDirection = new THREE.Vector3();
          camera.getWorldDirection(cameraDirection);

          dragState.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            cameraDirection,
            ringCenter
          );

          // Change handle color to indicate selection
          (handle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0xff0000);

          event.stopPropagation();
          event.preventDefault();
        }
      }
    }
  }

  /**
   * Handle mouse move - update handle position if dragging
   */
  function handleMouseMove(event: MouseEvent, canvas: HTMLCanvasElement) {
    if (!dragState.isDragging || !dragState.handle || !dragState.plane) return;

    const camera = getCamera();
    const mouldManager = getMouldManager();
    if (!camera || !mouldManager) return;

    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Raycast to find intersection with drag plane
    raycaster.setFromCamera(mouse, camera);
    const intersectPoint = new THREE.Vector3();
    const intersected = raycaster.ray.intersectPlane(dragState.plane, intersectPoint);

    if (intersected) {
      const userData = dragState.handle.mesh.userData;
      const ringCenter = userData.ringCenter as THREE.Vector3;
      const basis = userData.basis as { u: THREE.Vector3; v: THREE.Vector3 };

      // Calculate new radius (distance from ring center to intersection point)
      const delta = intersectPoint.clone().sub(ringCenter);
      const newRadius = delta.length();

      // Clamp radius to reasonable bounds
      const minRadius = 0.01;
      const maxRadius = 0.2;
      const clampedRadius = Math.max(minRadius, Math.min(maxRadius, newRadius));

      // Update handle position along its angle
      const angle = userData.angle as number;
      const handlePos = new THREE.Vector3(
        ringCenter.x + clampedRadius * (Math.cos(angle) * basis.u.x + Math.sin(angle) * basis.v.x),
        ringCenter.y + clampedRadius * (Math.cos(angle) * basis.u.y + Math.sin(angle) * basis.v.y),
        ringCenter.z + clampedRadius * (Math.cos(angle) * basis.u.z + Math.sin(angle) * basis.v.z)
      );

      dragState.handle.mesh.position.copy(handlePos);
      dragState.handle.radius = clampedRadius;

      // Notify about radius change
      onRadiusChange(
        dragState.handle.mouldId,
        dragState.handle.segmentIndex,
        dragState.handle.controlPointIndex,
        clampedRadius
      );
    }

    event.stopPropagation();
    event.preventDefault();
  }

  /**
   * Handle mouse up - end dragging
   */
  function handleMouseUp() {
    if (dragState.isDragging && dragState.handle) {
      // Reset handle color
      (dragState.handle.mesh.material as THREE.MeshBasicMaterial).color.setHex(0x00ff00);
    }

    dragState.isDragging = false;
    dragState.handle = null;
    dragState.plane = null;
  }

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
