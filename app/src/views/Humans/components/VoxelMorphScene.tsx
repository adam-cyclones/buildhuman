import { createEffect } from "solid-js";
import * as THREE from "three";
import ThreeScene from "./ThreeScene";
import { VoxelGrid } from "../morphing/voxel-grid";
import { dualContouring } from "../morphing/dual-contouring";
import { MouldManager } from "../morphing/mould-manager";
import { Skeleton } from "../morphing/skeleton";

type VoxelMorphSceneProps = {
  mouldRadius: number;
  jointMovement: { jointId: string; offset: [number, number, number] } | null;
  showWireframe: boolean;
};

export default function VoxelMorphScene(props: VoxelMorphSceneProps) {
  let sceneMesh: THREE.Mesh | undefined;
  let wireframeMesh: THREE.LineSegments | undefined;
  let currentSkeleton: Skeleton | undefined;
  let currentMouldManager: MouldManager | undefined;
  let isInitialized = false;

  const handleSceneReady = (_scene: THREE.Scene, mesh: THREE.Mesh) => {
    sceneMesh = mesh;
    initializeSkeletonAndMoulds();
    updateMesh();
  };

  // Initialize skeleton and mould structure (only once)
  const initializeSkeletonAndMoulds = () => {
    if (isInitialized) return;

    console.log("Initializing skeleton and moulds");

    // Create skeleton with joints for a simple humanoid
    const skeleton = new Skeleton();

    // Root joint (pelvis/torso center)
    skeleton.addJoint({
      id: "torso",
      position: [0, 0, 0],
      children: ["head", "shoulder-left", "shoulder-right", "hip-left", "hip-right"],
    });

    // Head joint (child of torso)
    skeleton.addJoint({
      id: "head",
      position: [0, 0.5, 0],
      parentId: "torso",
      children: [],
    });

    // Shoulder joints (children of torso)
    skeleton.addJoint({
      id: "shoulder-left",
      position: [-0.4, 0.1, 0],
      parentId: "torso",
      children: [],
    });

    skeleton.addJoint({
      id: "shoulder-right",
      position: [0.4, 0.1, 0],
      parentId: "torso",
      children: [],
    });

    // Leg joints (children of torso)
    skeleton.addJoint({
      id: "hip-left",
      position: [-0.15, -0.5, 0],
      parentId: "torso",
      children: [],
    });

    skeleton.addJoint({
      id: "hip-right",
      position: [0.15, -0.5, 0],
      parentId: "torso",
      children: [],
    });

    // Create mould manager and attach skeleton
    const mouldManager = new MouldManager();
    mouldManager.setSkeleton(skeleton);

    // Store references for joint manipulation
    currentSkeleton = skeleton;
    currentMouldManager = mouldManager;

    // Create moulds structure (with placeholder radius, will be updated)
    const blendRadius = 0.2;

    // Head (sphere attached to head joint)
    mouldManager.addMould({
      id: "head",
      shape: "sphere",
      center: [0, 0, 0],
      radius: 0.5 * 0.4, // Will be updated by updateMouldSizes
      blendRadius,
      parentJointId: "head",
    });
    mouldManager.setMouldOffset("head", [0, 0, 0]);

    // Torso (sphere attached to torso joint)
    mouldManager.addMould({
      id: "torso",
      shape: "sphere",
      center: [0, 0, 0],
      radius: 0.5 * 0.6,
      blendRadius,
      parentJointId: "torso",
    });
    mouldManager.setMouldOffset("torso", [0, 0, 0]);

    // Left arm (capsule)
    mouldManager.addMould({
      id: "arm-left",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [-0.3, -0.2, 0],
      radius: 0.5 * 0.15,
      blendRadius,
      parentJointId: "shoulder-left",
    });
    mouldManager.setMouldOffset("arm-left", [0, 0, 0]);

    // Right arm (capsule)
    mouldManager.addMould({
      id: "arm-right",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0.3, -0.2, 0],
      radius: 0.5 * 0.15,
      blendRadius,
      parentJointId: "shoulder-right",
    });
    mouldManager.setMouldOffset("arm-right", [0, 0, 0]);

    // Left leg (capsule)
    mouldManager.addMould({
      id: "leg-left",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.4, 0],
      radius: 0.5 * 0.2,
      blendRadius,
      parentJointId: "hip-left",
    });
    mouldManager.setMouldOffset("leg-left", [0, 0, 0]);

    // Right leg (capsule)
    mouldManager.addMould({
      id: "leg-right",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.4, 0],
      radius: 0.5 * 0.2,
      blendRadius,
      parentJointId: "hip-right",
    });
    mouldManager.setMouldOffset("leg-right", [0, 0, 0]);

    isInitialized = true;
  };

  // Update mould sizes based on current mouldRadius prop
  const updateMouldSizes = () => {
    if (!currentMouldManager) return;

    const baseRadius = props.mouldRadius;

    // Update each mould's radius
    const headMould = currentMouldManager.getMould("head");
    if (headMould) headMould.radius = baseRadius * 0.4;

    const torsoMould = currentMouldManager.getMould("torso");
    if (torsoMould) torsoMould.radius = baseRadius * 0.6;

    const armLeftMould = currentMouldManager.getMould("arm-left");
    if (armLeftMould) armLeftMould.radius = baseRadius * 0.15;

    const armRightMould = currentMouldManager.getMould("arm-right");
    if (armRightMould) armRightMould.radius = baseRadius * 0.15;

    const legLeftMould = currentMouldManager.getMould("leg-left");
    if (legLeftMould) legLeftMould.radius = baseRadius * 0.2;

    const legRightMould = currentMouldManager.getMould("leg-right");
    if (legRightMould) legRightMould.radius = baseRadius * 0.2;
  };

  // Regenerate mesh geometry
  const updateMesh = () => {
    if (!sceneMesh || !currentMouldManager) return;

    console.log("Updating mesh with radius:", props.mouldRadius);

    // Update mould sizes first
    updateMouldSizes();

    // Create voxel grid
    const grid = new VoxelGrid(64, {
      min: [-1, -1, -1],
      max: [1, 1, 1],
    });

    // Evaluate SDF with all moulds
    grid.evaluate(currentMouldManager);

    // Extract surface using Dual Contouring
    const meshData = dualContouring(
      grid,
      (p) => currentMouldManager!.evaluateSDF(p),
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

    // Create/update wireframe mesh
    updateWireframe(geometry);
  };

  const updateWireframe = (geometry: THREE.BufferGeometry) => {
    if (!sceneMesh) return;

    // Remove old wireframe if it exists
    if (wireframeMesh) {
      sceneMesh.remove(wireframeMesh);
      wireframeMesh.geometry.dispose();
      (wireframeMesh.material as THREE.Material).dispose();
    }

    // Create wireframe geometry using edges
    const wireframeGeometry = new THREE.EdgesGeometry(geometry);
    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: 0x000000,
      linewidth: 1,
    });

    wireframeMesh = new THREE.LineSegments(wireframeGeometry, wireframeMaterial);
    wireframeMesh.visible = props.showWireframe;
    // Add wireframe as child of mesh so it rotates together
    sceneMesh.add(wireframeMesh);
  };

  // Update mesh when radius changes
  createEffect(() => {
    // This will run whenever props.mouldRadius changes
    props.mouldRadius; // Track the dependency
    if (isInitialized) {
      updateMesh();
    }
  });

  // Handle wireframe toggle
  createEffect(() => {
    if (!wireframeMesh) return;
    wireframeMesh.visible = props.showWireframe;
  });

  // Handle joint movements
  createEffect(() => {
    const movement = props.jointMovement;
    if (!movement || !currentSkeleton || !sceneMesh || !currentMouldManager) return;

    console.log("Moving joint:", movement.jointId, "by", movement.offset);

    // Move the joint
    currentSkeleton.moveJoint(movement.jointId, movement.offset);

    // Regenerate mesh with updated skeleton positions
    const grid = new VoxelGrid(64, {
      min: [-1, -1, -1],
      max: [1, 1, 1],
    });

    // Evaluate SDF with updated positions
    grid.evaluate(currentMouldManager);

    // Extract surface
    const meshData = dualContouring(
      grid,
      (p) => currentMouldManager!.evaluateSDF(p),
      0
    );

    console.log("Regenerated mesh:", meshData.vertices.length / 3, "vertices");

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

    // Update wireframe mesh
    updateWireframe(geometry);
  });

  return <ThreeScene onSceneReady={handleSceneReady} />;
}
