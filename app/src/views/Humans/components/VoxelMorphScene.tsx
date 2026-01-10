import { createEffect } from "solid-js";
import * as THREE from "three";
import ThreeScene from "./ThreeScene";
import { VoxelGrid } from "../morphing/voxel-grid";
import { dualContouring } from "../morphing/dual-contouring";
import { MouldManager } from "../morphing/mould-manager";

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

    // Create mould manager and add multiple moulds
    const mouldManager = new MouldManager();

    // Create a simple humanoid form with 6 spheres (head, torso, arms, legs)
    const baseRadius = props.mouldRadius;
    const blendRadius = 0.2;

    // Head
    mouldManager.addMould({
      id: "head",
      center: [0, 0.5, 0],
      radius: baseRadius * 0.4,
      blendRadius,
    });

    // Torso
    mouldManager.addMould({
      id: "torso",
      center: [0, 0, 0],
      radius: baseRadius * 0.6,
      blendRadius,
    });

    // Left arm
    mouldManager.addMould({
      id: "arm-left",
      center: [-0.4, 0.1, 0],
      radius: baseRadius * 0.25,
      blendRadius,
    });

    // Right arm
    mouldManager.addMould({
      id: "arm-right",
      center: [0.4, 0.1, 0],
      radius: baseRadius * 0.25,
      blendRadius,
    });

    // Left leg
    mouldManager.addMould({
      id: "leg-left",
      center: [-0.15, -0.5, 0],
      radius: baseRadius * 0.3,
      blendRadius,
    });

    // Right leg
    mouldManager.addMould({
      id: "leg-right",
      center: [0.15, -0.5, 0],
      radius: baseRadius * 0.3,
      blendRadius,
    });

    // Evaluate SDF with all moulds
    grid.evaluate(mouldManager);

    // Extract surface using Dual Contouring
    const meshData = dualContouring(
      grid,
      (p) => mouldManager.evaluateSDF(p),
      0
    );

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
