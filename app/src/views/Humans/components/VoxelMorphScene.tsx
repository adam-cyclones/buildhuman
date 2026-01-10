import { createEffect } from "solid-js";
import * as THREE from "three";
import ThreeScene from "./ThreeScene";
import { VoxelGrid } from "../morphing/voxel-grid";
import { dualContouring } from "../morphing/dual-contouring";
import { MouldManager } from "../morphing/mould-manager";
import { Skeleton } from "../morphing/skeleton";
import { identityQuat } from "../morphing/transform";

type VoxelMorphSceneProps = {
  mouldRadius: number;
  jointMovement: { jointId: string; offset: [number, number, number] } | null;
  showWireframe: boolean;
  showSkeleton: boolean;
  selectedJointId: string | null;
};

export default function VoxelMorphScene(props: VoxelMorphSceneProps) {
  let sceneMesh: THREE.Mesh | undefined;
  let wireframeMesh: THREE.LineSegments | undefined;
  let skeletonGroup: THREE.Group | undefined;
  let jointSpheres: Map<string, THREE.Mesh> = new Map();
  let currentScene: THREE.Scene | undefined;
  let currentSkeleton: Skeleton | undefined;
  let currentMouldManager: MouldManager | undefined;
  let isInitialized = false;

  const handleSceneReady = (scene: THREE.Scene, mesh: THREE.Mesh) => {
    currentScene = scene;
    sceneMesh = mesh;
    initializeSkeletonAndMoulds();
    updateMesh();
    createSkeletonVisualization();
  };

  // Initialize skeleton and mould structure (only once)
  const initializeSkeletonAndMoulds = () => {
    if (isInitialized) return;

    console.log("Initializing skeleton and moulds with bone transforms");

    // Create skeleton with joints for a simple humanoid
    // Joints now use localOffset (parent-relative) and localRotation
    const skeleton = new Skeleton();
    const identityRot = identityQuat();

    // Root joint (pelvis/torso center) - world position [0,0,0]
    skeleton.addJoint({
      id: "torso",
      localOffset: [0, 0, 0], // Root has no parent, so local = world
      localRotation: identityRot,
      children: ["head", "shoulder-left", "shoulder-right", "hip-left", "hip-right"],
    });

    // Head joint - offset UP from torso
    skeleton.addJoint({
      id: "head",
      localOffset: [0, 0.5, 0], // 0.5 units up in torso's local space
      localRotation: identityRot,
      parentId: "torso",
      children: [],
    });

    // Left shoulder - offset LEFT and slightly UP from torso
    skeleton.addJoint({
      id: "shoulder-left",
      localOffset: [-0.4, 0.1, 0], // Left in torso's local space
      localRotation: identityRot,
      parentId: "torso",
      children: [],
    });

    // Right shoulder - offset RIGHT and slightly UP from torso
    skeleton.addJoint({
      id: "shoulder-right",
      localOffset: [0.4, 0.1, 0], // Right in torso's local space
      localRotation: identityRot,
      parentId: "torso",
      children: [],
    });

    // Left hip - offset LEFT and DOWN from torso
    skeleton.addJoint({
      id: "hip-left",
      localOffset: [-0.15, -0.5, 0], // Down in torso's local space
      localRotation: identityRot,
      parentId: "torso",
      children: [],
    });

    // Right hip - offset RIGHT and DOWN from torso
    skeleton.addJoint({
      id: "hip-right",
      localOffset: [0.15, -0.5, 0], // Down in torso's local space
      localRotation: identityRot,
      parentId: "torso",
      children: [],
    });

    // Create mould manager and attach skeleton
    const mouldManager = new MouldManager();
    mouldManager.setSkeleton(skeleton);

    // Store references for joint manipulation
    currentSkeleton = skeleton;
    currentMouldManager = mouldManager;

    // Create moulds structure in BONE-LOCAL space
    // Moulds are now attached to bone frames, not world positions
    const blendRadius = 0.2;

    // Head sphere - centered on head joint
    mouldManager.addMould({
      id: "head",
      shape: "sphere",
      center: [0, 0, 0], // At head joint origin (bone-local)
      radius: 0.5 * 0.4,
      blendRadius,
      parentJointId: "head",
    });

    // Torso sphere - centered on torso joint
    mouldManager.addMould({
      id: "torso",
      shape: "sphere",
      center: [0, 0, 0], // At torso joint origin (bone-local)
      radius: 0.5 * 0.6,
      blendRadius,
      parentJointId: "torso",
    });

    // Left arm capsule - extends down and left from shoulder
    mouldManager.addMould({
      id: "arm-left",
      shape: "capsule",
      center: [0, 0, 0], // Start at shoulder joint (bone-local)
      endPoint: [-0.3, -0.2, 0], // End point in shoulder's local space
      radius: 0.5 * 0.15,
      blendRadius,
      parentJointId: "shoulder-left",
    });

    // Right arm capsule - extends down and right from shoulder
    mouldManager.addMould({
      id: "arm-right",
      shape: "capsule",
      center: [0, 0, 0], // Start at shoulder joint (bone-local)
      endPoint: [0.3, -0.2, 0], // End point in shoulder's local space
      radius: 0.5 * 0.15,
      blendRadius,
      parentJointId: "shoulder-right",
    });

    // Left leg capsule - extends down from hip
    mouldManager.addMould({
      id: "leg-left",
      shape: "capsule",
      center: [0, 0, 0], // Start at hip joint (bone-local)
      endPoint: [0, -0.4, 0], // Extend down in hip's local space
      radius: 0.5 * 0.2,
      blendRadius,
      parentJointId: "hip-left",
    });

    // Right leg capsule - extends down from hip
    mouldManager.addMould({
      id: "leg-right",
      shape: "capsule",
      center: [0, 0, 0], // Start at hip joint (bone-local)
      endPoint: [0, -0.4, 0], // Extend down in hip's local space
      radius: 0.5 * 0.2,
      blendRadius,
      parentJointId: "hip-right",
    });

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

  // Create skeleton visualization with bones and joints
  const createSkeletonVisualization = () => {
    if (!currentScene || !currentSkeleton) return;

    // Remove existing skeleton visualization
    if (skeletonGroup) {
      currentScene.remove(skeletonGroup);
      skeletonGroup.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    // Create new group for skeleton
    skeletonGroup = new THREE.Group();
    jointSpheres.clear();

    // Materials
    const boneMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2 });
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const selectedJointMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    const jointGeometry = new THREE.SphereGeometry(0.03, 8, 8);

    // Draw each joint as a sphere
    const joints = currentSkeleton.getJoints();
    for (const joint of joints) {
      const worldPos = currentSkeleton.getWorldPosition(joint.id);

      // Create joint sphere
      const isSelected = joint.id === props.selectedJointId;
      const sphere = new THREE.Mesh(
        jointGeometry,
        isSelected ? selectedJointMaterial : jointMaterial
      );
      sphere.position.set(worldPos[0], worldPos[1], worldPos[2]);
      sphere.userData = { jointId: joint.id }; // Store joint ID for selection
      skeletonGroup.add(sphere);
      jointSpheres.set(joint.id, sphere);

      // Draw bone line to parent
      if (joint.parentId) {
        const parentPos = currentSkeleton.getWorldPosition(joint.parentId);
        const points = [
          new THREE.Vector3(parentPos[0], parentPos[1], parentPos[2]),
          new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2])
        ];
        const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(lineGeometry, boneMaterial);
        skeletonGroup.add(line);
      }
    }

    skeletonGroup.visible = props.showSkeleton;

    // Add skeleton as child of mesh so it rotates together
    if (sceneMesh) {
      sceneMesh.add(skeletonGroup);
    } else {
      currentScene.add(skeletonGroup);
    }
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

  // Handle skeleton visibility toggle
  createEffect(() => {
    if (!skeletonGroup) return;
    skeletonGroup.visible = props.showSkeleton;
  });

  // Handle joint selection changes
  createEffect(() => {
    const selected = props.selectedJointId;
    if (!jointSpheres.size) return;

    // Update all joint materials
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const selectedJointMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });

    jointSpheres.forEach((sphere, jointId) => {
      const oldMaterial = sphere.material as THREE.Material;
      sphere.material = jointId === selected ? selectedJointMaterial : jointMaterial;
      oldMaterial.dispose();
    });
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

    // Update skeleton visualization
    createSkeletonVisualization();
  });

  return <ThreeScene onSceneReady={handleSceneReady} />;
}
