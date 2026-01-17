import * as THREE from "three";

export const updateWireframe = (
  geometry: THREE.BufferGeometry,
  sceneMesh: THREE.Mesh,
  showWireframe: boolean,
  existingWireframe?: THREE.LineSegments
): THREE.LineSegments => {
  // Remove old wireframe if it exists
  if (existingWireframe) {
    sceneMesh.remove(existingWireframe);
    existingWireframe.geometry.dispose();
    (existingWireframe.material as THREE.Material).dispose();
  }

  // Create wireframe geometry using edges
  const wireframeGeometry = new THREE.EdgesGeometry(geometry);
  const wireframeMaterial = new THREE.LineBasicMaterial({
    color: 0x000000,
    linewidth: 1,
  });

  const wireframeMesh = new THREE.LineSegments(
    wireframeGeometry,
    wireframeMaterial
  );
  wireframeMesh.visible = showWireframe;
  // Add wireframe as child of mesh so it rotates together
  sceneMesh.add(wireframeMesh);

  return wireframeMesh;
};
