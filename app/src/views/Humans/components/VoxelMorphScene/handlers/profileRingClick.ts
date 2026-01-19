import * as THREE from "three";
import type { MouldManager } from "../../../morphing/mould-manager";

/**
 * Creates a profile ring click handler
 *
 * @param getCamera - Function to get current camera
 * @param getCanvas - Function to get canvas element
 * @param getProfileRingsGroup - Function to get profile rings group
 * @param getMouldManager - Function to get mould manager
 * @param onProfileRingClicked - Callback when a ring is clicked
 * @returns Click handler function
 */
export function createProfileRingClickHandler(
  getCamera: () => THREE.Camera | undefined,
  getCanvas: () => HTMLCanvasElement | undefined,
  getProfileRingsGroup: () => THREE.Group | undefined,
  getMouldManager: () => MouldManager | undefined,
  onProfileRingClicked?: (mouldId: string, segmentIndex: number) => void
) {
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0.02 }; // Tolerance for line picking

  function handleClick(event: MouseEvent): boolean {
    const camera = getCamera();
    const canvas = getCanvas();
    const profileRingsGroup = getProfileRingsGroup();

    if (!camera || !canvas || !profileRingsGroup || !onProfileRingClicked) {
      return false;
    }

    // Calculate mouse position in normalized device coordinates
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Raycast against profile ring lines
    raycaster.setFromCamera(mouse, camera);

    // Get all children of the profile rings group
    const ringLines: THREE.Object3D[] = [];
    profileRingsGroup.traverse((child) => {
      if (child instanceof THREE.LineLoop && child.userData.type === "profile-ring") {
        ringLines.push(child);
      }
    });

    if (ringLines.length === 0) return false;

    const intersects = raycaster.intersectObjects(ringLines);

    console.log("Profile ring raycast:", {
      ringsCount: ringLines.length,
      intersectsCount: intersects.length,
      mouse
    });

    if (intersects.length > 0) {
      const intersected = intersects[0].object;
      const userData = intersected.userData;

      console.log("Intersected ring:", userData);

      if (userData.type === "profile-ring") {
        const mouldManager = getMouldManager();
        if (!mouldManager) return false;

        const mould = mouldManager.getMould(userData.mouldId);
        if (!mould || mould.shape !== "profiled-capsule" || !mould.radialProfiles) {
          return false;
        }

        console.log("Calling onProfileRingClicked:", userData.mouldId, userData.segmentIndex);
        onProfileRingClicked(userData.mouldId, userData.segmentIndex);
        event.stopPropagation();
        event.preventDefault();
        return true;
      }
    }

    return false;
  }

  return { handleClick };
}
