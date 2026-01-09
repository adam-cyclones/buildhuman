import { createEffect } from "solid-js";
import * as THREE from "three";
import ThreeScene from "./ThreeScene";
import { VoxelGrid } from "../morphing/voxel-grid";
import { marchingCubes } from "../morphing/marching-cubes";
import type { Mould } from "../morphing/types";

type VoxelMorphSceneProps = {
  mouldRadius: number;
};

export default function VoxelMorphScene(props: VoxelMorphSceneProps) {
  let sceneMesh: THREE.Mesh | undefined;

  const handleSceneReady = (_scene: THREE.Scene, mesh: THREE.Mesh) => {
    sceneMesh = mesh;
    updateMesh();
  };

  const updateMesh = () => {
    if (!sceneMesh) return;

    console.log("Updating mesh with radius:", props.mouldRadius);

    // Create voxel grid
    const grid = new VoxelGrid(32, {
      min: [-1, -1, -1],
      max: [1, 1, 1],
    });

    // Define mould
    const mould: Mould = {
      center: [0, 0, 0],
      radius: props.mouldRadius,
    };

    // Evaluate SDF
    grid.evaluate(mould);

    // Extract surface
    const meshData = marchingCubes(grid, 0);

    console.log("Generated mesh:", meshData.vertices.length / 3, "vertices");

    // Update Three.js geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(meshData.vertices), 3)
    );
    geometry.setIndex(meshData.indices);
    geometry.computeVertexNormals();

    sceneMesh.geometry.dispose();
    sceneMesh.geometry = geometry;
  };

  // Update mesh when radius changes
  createEffect(() => {
    // This will run whenever props.mouldRadius changes
    props.mouldRadius; // Track the dependency
    updateMesh();
  });

  return <ThreeScene onSceneReady={handleSceneReady} />;
}
