import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";

export const regenerateMeshFromRust = async (
  sceneMesh: THREE.Mesh,
  resolution: number,
  fastMode: boolean,
  onMeshReady: (ready: boolean) => void,
  updateWireframe: (geometry: THREE.BufferGeometry) => void
): Promise<void> => {
  try {
    // 1. Invoke the command. The result is automatically an ArrayBuffer.
    const buffer = await invoke<ArrayBuffer>("generate_mesh_binary", {
      resolution,
      fast_mode: fastMode
    });

    // 2. Parse the metadata header
    const dataView = new DataView(buffer);
    const vertexDataLen = dataView.getUint32(0, true); // `true` for little-endian
    const indexDataLen = dataView.getUint32(4, true);
    const normalDataLen = dataView.getUint32(8, true);
    let offset = 12;

    // 3. Create typed array VIEWS on the buffer (NO COPYING)
    const vertices = new Float32Array(
      buffer,
      offset,
      vertexDataLen / Float32Array.BYTES_PER_ELEMENT
    );
    offset += vertexDataLen;

    const indices = new Uint32Array(
      buffer,
      offset,
      indexDataLen / Uint32Array.BYTES_PER_ELEMENT
    );
    offset += indexDataLen;

    const normals = new Float32Array(
      buffer,
      offset,
      normalDataLen / Float32Array.BYTES_PER_ELEMENT
    );

    // 4. Update the Three.js geometry
    const geometry = sceneMesh.geometry as THREE.BufferGeometry;

    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    if (normals.length > 0) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    } else {
      geometry.deleteAttribute("normal"); // Remove if not provided
    }
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // Let Three.js know the data has been updated
    geometry.attributes.position.needsUpdate = true;
    if (geometry.attributes.normal) {
      geometry.attributes.normal.needsUpdate = true;
    }
    if (geometry.index) {
      geometry.index.needsUpdate = true;
    }

    const meshReady = geometry.attributes.position.count > 0;
    onMeshReady(meshReady);

    // Smooth shading for lower resolutions - recompute normals to smooth appearance
    // This averages normals across shared vertices, hiding faceting
    if (resolution <= 64) {
      geometry.computeVertexNormals();
    }

    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    // Create/update wireframe mesh
    updateWireframe(geometry);
  } catch (e) {
    console.error("Error invoking Rust command 'generate_mesh_binary':", e);
  }
};
