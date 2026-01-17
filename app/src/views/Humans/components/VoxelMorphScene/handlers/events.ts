import * as THREE from "three";
import type { Skeleton } from "../../../morphing/skeleton";

export const createCanvasClickHandler = (
  getCanvas: () => HTMLCanvasElement | undefined,
  getCamera: () => THREE.Camera | undefined,
  getScene: () => THREE.Scene | undefined,
  getJointSpheres: () => Map<string, THREE.Mesh>,
  onJointClicked?: (jointId: string) => void
) => {
  return (event: MouseEvent) => {
    const canvas = getCanvas();
    const camera = getCamera();
    const scene = getScene();
    const jointSpheres = getJointSpheres();

    if (!canvas || !camera || !scene || jointSpheres.size === 0) return;

    // Calculate mouse position in normalized device coordinates (-1 to +1)
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Create raycaster
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    // Get all joint sphere meshes as an array
    const jointMeshes = Array.from(jointSpheres.values());

    // Check for intersections
    const intersects = raycaster.intersectObjects(jointMeshes);

    if (intersects.length > 0) {
      // Find which joint was clicked
      const clickedMesh = intersects[0].object as THREE.Mesh;
      for (const [jointId, mesh] of jointSpheres.entries()) {
        if (mesh === clickedMesh) {
          // Notify parent component
          if (onJointClicked) {
            onJointClicked(jointId);
          }
          break;
        }
      }
    }
  };
};
