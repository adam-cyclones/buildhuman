import { createEffect } from "solid-js";
import * as THREE from "three";
import ThreeScene from "./ThreeScene";
import { VoxelGrid } from "../morphing/voxel-grid";
import { dualContouring } from "../morphing/dual-contouring";
import { MouldManager } from "../morphing/mould-manager";
import { Skeleton } from "../morphing/skeleton";
import { identityQuat, eulerToQuat, multiplyQuat } from "../morphing/transform";

type VoxelMorphSceneProps = {
  mouldRadius: number;
  jointMovement: { jointId: string; offset: [number, number, number] } | null;
  jointRotation: { jointId: string; euler: [number, number, number] } | null;
  showWireframe: boolean;
  showSkeleton: boolean;
  selectedJointId: string | null;
  onSkeletonReady?: (joints: Array<{ id: string; parentId?: string; children: string[] }>) => void;
  onMouldsReady?: (moulds: Array<{ id: string; shape: "sphere" | "capsule"; parentJointId?: string }>) => void;
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

    // Create skeleton with joints for a more complete humanoid
    // Joints now use localOffset (parent-relative) and localRotation
    const skeleton = new Skeleton();
    const identityRot = identityQuat();

    // Root joint (pelvis) - world position [0,0,0]
    skeleton.addJoint({
      id: "pelvis",
      localOffset: [0, 0, 0],
      localRotation: identityRot,
      children: ["spine-lower", "hip-left", "hip-right"],
    });

    // Spine chain
    skeleton.addJoint({
      id: "spine-lower",
      localOffset: [0, 0.15, 0],
      localRotation: identityRot,
      parentId: "pelvis",
      children: ["spine-upper"],
    });

    skeleton.addJoint({
      id: "spine-upper",
      localOffset: [0, 0.15, 0],
      localRotation: identityRot,
      parentId: "spine-lower",
      children: ["chest"],
    });

    skeleton.addJoint({
      id: "chest",
      localOffset: [0, 0.15, 0],
      localRotation: identityRot,
      parentId: "spine-upper",
      children: ["neck", "shoulder-left", "shoulder-right"],
    });

    // Neck and head
    skeleton.addJoint({
      id: "neck",
      localOffset: [0, 0.15, 0],
      localRotation: identityRot,
      parentId: "chest",
      children: ["head"],
    });

    skeleton.addJoint({
      id: "head",
      localOffset: [0, 0.1, 0],
      localRotation: identityRot,
      parentId: "neck",
      children: [],
    });

    // Left arm chain
    skeleton.addJoint({
      id: "shoulder-left",
      localOffset: [-0.15, 0.05, 0],
      localRotation: identityRot,
      parentId: "chest",
      children: ["elbow-left"],
    });

    skeleton.addJoint({
      id: "elbow-left",
      localOffset: [-0.25, 0, 0],
      localRotation: identityRot,
      parentId: "shoulder-left",
      children: ["wrist-left"],
    });

    skeleton.addJoint({
      id: "wrist-left",
      localOffset: [-0.2, 0, 0],
      localRotation: identityRot,
      parentId: "elbow-left",
      children: ["hand-left"],
    });

    skeleton.addJoint({
      id: "hand-left",
      localOffset: [-0.08, 0, 0],
      localRotation: identityRot,
      parentId: "wrist-left",
      children: [],
    });

    // Right arm chain
    skeleton.addJoint({
      id: "shoulder-right",
      localOffset: [0.15, 0.05, 0],
      localRotation: identityRot,
      parentId: "chest",
      children: ["elbow-right"],
    });

    skeleton.addJoint({
      id: "elbow-right",
      localOffset: [0.25, 0, 0],
      localRotation: identityRot,
      parentId: "shoulder-right",
      children: ["wrist-right"],
    });

    skeleton.addJoint({
      id: "wrist-right",
      localOffset: [0.2, 0, 0],
      localRotation: identityRot,
      parentId: "elbow-right",
      children: ["hand-right"],
    });

    skeleton.addJoint({
      id: "hand-right",
      localOffset: [0.08, 0, 0],
      localRotation: identityRot,
      parentId: "wrist-right",
      children: [],
    });

    // Left leg chain
    skeleton.addJoint({
      id: "hip-left",
      localOffset: [-0.1, 0, 0],
      localRotation: identityRot,
      parentId: "pelvis",
      children: ["knee-left"],
    });

    skeleton.addJoint({
      id: "knee-left",
      localOffset: [0, -0.4, 0],
      localRotation: identityRot,
      parentId: "hip-left",
      children: ["ankle-left"],
    });

    skeleton.addJoint({
      id: "ankle-left",
      localOffset: [0, -0.35, 0],
      localRotation: identityRot,
      parentId: "knee-left",
      children: ["foot-left"],
    });

    skeleton.addJoint({
      id: "foot-left",
      localOffset: [0, -0.05, 0.08],
      localRotation: identityRot,
      parentId: "ankle-left",
      children: [],
    });

    // Right leg chain
    skeleton.addJoint({
      id: "hip-right",
      localOffset: [0.1, 0, 0],
      localRotation: identityRot,
      parentId: "pelvis",
      children: ["knee-right"],
    });

    skeleton.addJoint({
      id: "knee-right",
      localOffset: [0, -0.4, 0],
      localRotation: identityRot,
      parentId: "hip-right",
      children: ["ankle-right"],
    });

    skeleton.addJoint({
      id: "ankle-right",
      localOffset: [0, -0.35, 0],
      localRotation: identityRot,
      parentId: "knee-right",
      children: ["foot-right"],
    });

    skeleton.addJoint({
      id: "foot-right",
      localOffset: [0, -0.05, 0.08],
      localRotation: identityRot,
      parentId: "ankle-right",
      children: [],
    });

    // Create mould manager and attach skeleton
    const mouldManager = new MouldManager();
    mouldManager.setSkeleton(skeleton);

    // Store references for joint manipulation
    currentSkeleton = skeleton;
    currentMouldManager = mouldManager;

    // Notify parent of skeleton structure
    if (props.onSkeletonReady) {
      const joints = skeleton.getJoints().map(j => ({
        id: j.id,
        parentId: j.parentId,
        children: j.children
      }));
      props.onSkeletonReady(joints);
    }

    // Create moulds structure following bone hierarchy
    // Capsules connect parent joints to child joints along bone tangents
    const blendRadius = 0.2;

    // Head sphere
    mouldManager.addMould({
      id: "head",
      shape: "sphere",
      center: [0, 0.05, 0],
      radius: 0.5 * 0.15,
      blendRadius,
      parentJointId: "head",
    });

    // Neck capsule (connects chest to head through neck joint)
    mouldManager.addMould({
      id: "neck",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, 0.1, 0], // To head joint (local offset)
      radius: 0.5 * 0.08,
      blendRadius,
      parentJointId: "neck",
    });

    // Chest/Upper torso
    mouldManager.addMould({
      id: "chest",
      shape: "sphere",
      center: [0, 0, 0],
      radius: 0.5 * 0.18,
      blendRadius,
      parentJointId: "chest",
    });

    // Spine segments (capsules following bone chain)
    mouldManager.addMould({
      id: "spine-upper",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, 0.15, 0], // To chest
      radius: 0.5 * 0.15,
      blendRadius,
      parentJointId: "spine-upper",
    });

    mouldManager.addMould({
      id: "spine-lower",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, 0.15, 0], // To spine-upper
      radius: 0.5 * 0.16,
      blendRadius,
      parentJointId: "spine-lower",
    });

    // Pelvis
    mouldManager.addMould({
      id: "pelvis",
      shape: "sphere",
      center: [0, 0, 0],
      radius: 0.5 * 0.17,
      blendRadius,
      parentJointId: "pelvis",
    });

    // Left arm chain (capsules follow bone direction)
    mouldManager.addMould({
      id: "upper-arm-left",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [-0.25, 0, 0], // To elbow (shoulder's local offset to elbow)
      radius: 0.5 * 0.07,
      blendRadius,
      parentJointId: "shoulder-left",
    });

    mouldManager.addMould({
      id: "forearm-left",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [-0.2, 0, 0], // To wrist
      radius: 0.5 * 0.06,
      blendRadius,
      parentJointId: "elbow-left",
    });

    mouldManager.addMould({
      id: "hand-left",
      shape: "sphere",
      center: [-0.04, 0, 0], // Midpoint of hand
      radius: 0.5 * 0.05,
      blendRadius,
      parentJointId: "hand-left",
    });

    // Right arm chain
    mouldManager.addMould({
      id: "upper-arm-right",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0.25, 0, 0], // To elbow
      radius: 0.5 * 0.07,
      blendRadius,
      parentJointId: "shoulder-right",
    });

    mouldManager.addMould({
      id: "forearm-right",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0.2, 0, 0], // To wrist
      radius: 0.5 * 0.06,
      blendRadius,
      parentJointId: "elbow-right",
    });

    mouldManager.addMould({
      id: "hand-right",
      shape: "sphere",
      center: [0.04, 0, 0], // Midpoint of hand
      radius: 0.5 * 0.05,
      blendRadius,
      parentJointId: "hand-right",
    });

    // Left leg chain
    mouldManager.addMould({
      id: "thigh-left",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.4, 0], // To knee
      radius: 0.5 * 0.1,
      blendRadius,
      parentJointId: "hip-left",
    });

    mouldManager.addMould({
      id: "shin-left",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.35, 0], // To ankle
      radius: 0.5 * 0.08,
      blendRadius,
      parentJointId: "knee-left",
    });

    mouldManager.addMould({
      id: "foot-left",
      shape: "sphere",
      center: [0, 0, 0.04],
      radius: 0.5 * 0.06,
      blendRadius,
      parentJointId: "foot-left",
    });

    // Right leg chain
    mouldManager.addMould({
      id: "thigh-right",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.4, 0], // To knee
      radius: 0.5 * 0.1,
      blendRadius,
      parentJointId: "hip-right",
    });

    mouldManager.addMould({
      id: "shin-right",
      shape: "capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.35, 0], // To ankle
      radius: 0.5 * 0.08,
      blendRadius,
      parentJointId: "knee-right",
    });

    mouldManager.addMould({
      id: "foot-right",
      shape: "sphere",
      center: [0, 0, 0.04],
      radius: 0.5 * 0.06,
      blendRadius,
      parentJointId: "foot-right",
    });

    // Notify parent of moulds structure
    if (props.onMouldsReady) {
      const moulds = mouldManager.getMoulds().map(m => ({
        id: m.id,
        shape: m.shape,
        parentJointId: m.parentJointId
      }));
      props.onMouldsReady(moulds);
    }

    isInitialized = true;
  };

  // Update mould sizes based on current mouldRadius prop
  const updateMouldSizes = () => {
    if (!currentMouldManager) return;

    const r = props.mouldRadius;

    // Update each mould's radius (preserving relative proportions)
    const moulds = [
      { id: "head", radius: r * 0.15 },
      { id: "neck", radius: r * 0.08 },
      { id: "chest", radius: r * 0.18 },
      { id: "spine-upper", radius: r * 0.15 },
      { id: "spine-lower", radius: r * 0.16 },
      { id: "pelvis", radius: r * 0.17 },
      { id: "upper-arm-left", radius: r * 0.07 },
      { id: "forearm-left", radius: r * 0.06 },
      { id: "hand-left", radius: r * 0.05 },
      { id: "upper-arm-right", radius: r * 0.07 },
      { id: "forearm-right", radius: r * 0.06 },
      { id: "hand-right", radius: r * 0.05 },
      { id: "thigh-left", radius: r * 0.1 },
      { id: "shin-left", radius: r * 0.08 },
      { id: "foot-left", radius: r * 0.06 },
      { id: "thigh-right", radius: r * 0.1 },
      { id: "shin-right", radius: r * 0.08 },
      { id: "foot-right", radius: r * 0.06 },
    ];

    moulds.forEach(({ id, radius }) => {
      const mould = currentMouldManager!.getMould(id);
      if (mould) mould.radius = radius;
    });
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
      // Remove from actual parent (sceneMesh or currentScene)
      if (skeletonGroup.parent) {
        skeletonGroup.parent.remove(skeletonGroup);
      }
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

  // Handle joint rotations
  createEffect(() => {
    const rotation = props.jointRotation;
    if (!rotation || !currentSkeleton || !sceneMesh || !currentMouldManager) return;

    console.log("Rotating joint:", rotation.jointId, "by", rotation.euler);

    // Get current joint rotation
    const joint = currentSkeleton.getJoint(rotation.jointId);
    if (!joint) return;

    // Convert euler angles to quaternion
    const deltaQuat = eulerToQuat(rotation.euler[0], rotation.euler[1], rotation.euler[2]);

    // Multiply current rotation by delta rotation
    const newRotation = multiplyQuat(joint.localRotation, deltaQuat);

    // Apply the new rotation
    currentSkeleton.setJointLocalRotation(rotation.jointId, newRotation);

    // Regenerate mesh with updated skeleton rotations
    const grid = new VoxelGrid(64, {
      min: [-1, -1, -1],
      max: [1, 1, 1],
    });

    // Evaluate SDF with updated rotations
    grid.evaluate(currentMouldManager);

    // Extract surface
    const meshData = dualContouring(
      grid,
      (p) => currentMouldManager!.evaluateSDF(p),
      0
    );

    console.log("Regenerated mesh after rotation:", meshData.vertices.length / 3, "vertices");

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
