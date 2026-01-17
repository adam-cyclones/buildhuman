import { createEffect, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import ThreeScene from "../ThreeScene";
import { MouldManager } from "../../morphing/mould-manager";
import { Skeleton } from "../../morphing/skeleton";
import { identityQuat, eulerToQuat, multiplyQuat } from "../../morphing/transform";
import type { VoxelMorphSceneProps } from "./types";
import { setupSnapshotAutomation } from "./snapshots/automation";
import { createSkeletonVisualization, updateSkeletonSelection } from "./visualization/skeleton";
import { createProfileRingsVisualization } from "./visualization/profileRings";
import { updateWireframe as updateWireframeVisualization } from "./visualization/wireframe";
import { regenerateMeshFromRust } from "./mesh/generation";
import { createRustSyncScheduler } from "./mesh/rustSync";
import { createCanvasClickHandler } from "./handlers/events";

export default function VoxelMorphScene(props: VoxelMorphSceneProps) {
  let sceneMesh: THREE.Mesh | undefined;
  let wireframeMesh: THREE.LineSegments | undefined;
  let skeletonGroup: THREE.Group | undefined;
  let profileRingsGroup: THREE.Group | undefined;
  let jointSpheres: Map<string, THREE.Mesh> = new Map();
  let currentScene: THREE.Scene | undefined;
  let currentCamera: THREE.Camera | undefined;
  let currentCanvas: HTMLCanvasElement | undefined;
  let currentRenderer: THREE.WebGLRenderer | undefined;
  let currentSkeleton: Skeleton | undefined;
  let currentMouldManager: MouldManager | undefined;
  let isInitialized = false;
  let meshReady = false;
  let snapshotListener: (() => void) | undefined;
  let snapshotTimeoutId: number | undefined;
  let snapshotInitialized = false;

  // Create canvas click handler using extracted module
  const handleCanvasClick = createCanvasClickHandler(
    () => currentCanvas,
    () => currentCamera,
    () => currentScene,
    () => jointSpheres,
    props.onJointClicked
  );

  const handleSceneReady = async (
    scene: THREE.Scene,
    mesh: THREE.Mesh,
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
    renderer: THREE.WebGLRenderer
  ) => {
    currentScene = scene;
    sceneMesh = mesh;
    currentCamera = camera;
    currentCanvas = canvas;
    currentRenderer = renderer;

    // Add click listener to canvas for joint selection
    canvas.addEventListener('click', handleCanvasClick);

    await initializeSkeletonAndMoulds();
    updateMesh();
    await createSkeletonVisualizationWrapper();
    await createProfileRingsVisualizationWrapper();
    await setupSnapshotWrapper();
  };

  // Wrapper for snapshot automation using extracted module
  const setupSnapshotWrapper = async () => {
    if (snapshotInitialized) return;
    snapshotInitialized = true;

    await setupSnapshotAutomation(
      () => meshReady,
      () => currentCanvas,
      () => currentRenderer,
      () => currentScene,
      () => currentCamera,
      onCleanup
    );
  };

  onMount(() => {
    void setupSnapshotWrapper();
  });

  // Wrapper for updateWireframe using extracted module
  const updateWireframe = (geometry: THREE.BufferGeometry) => {
    if (!sceneMesh) return;
    wireframeMesh = updateWireframeVisualization(
      geometry,
      sceneMesh,
      props.showWireframe,
      wireframeMesh
    );
  };

  // Initialize skeleton and mould structure (only once)
  const initializeSkeletonAndMoulds = async () => {
    if (isInitialized) return;

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
      localOffset: [0, 0, 0.12],
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
      localOffset: [0, 0, 0.12],
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
      const joints = skeleton.getJoints().map((j) => ({
        id: j.id,
        parentId: j.parentId,
        children: j.children,
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
      blendRadius: 0.08, // Reduced from 0.2 to avoid inflating legs
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

    // Left leg chain - thigh with muscle profile
    mouldManager.addMould({
      id: "thigh-left",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.4, 0], // To knee
      radius: 0.5 * 0.1,
      blendRadius: 0.02, // Minimal blend for profiled capsules
      parentJointId: "hip-left",
      radialProfiles: [
        // Control points at angles: 0° (lateral/right), 45°, 90° (front), 135°, 180° (medial/inner), 225°, 270° (back), 315°
        // Seg 0: Hip - fuller, slightly oval (medial slightly flattened)
        [0.055, 0.056, 0.057, 0.056, 0.052, 0.055, 0.058, 0.056],
        // Seg 1: Upper thigh - quads bulge (front 90°), hamstrings (back 270°), medial flat (180°)
        [0.058, 0.060, 0.065, 0.060, 0.052, 0.058, 0.063, 0.060],
        // Seg 2: Mid thigh - maximum quad development, medial flattening
        [0.060, 0.062, 0.068, 0.062, 0.054, 0.060, 0.066, 0.062],
        // Seg 3: Lower mid thigh - starting to taper, medial still flat
        [0.056, 0.058, 0.061, 0.058, 0.051, 0.056, 0.060, 0.058],
        // Seg 4: Above knee - significant taper, medial flattening
        [0.050, 0.052, 0.054, 0.052, 0.047, 0.050, 0.053, 0.052],
        // Seg 5: Knee approach - narrowest, more circular
        [0.046, 0.047, 0.048, 0.047, 0.045, 0.046, 0.047, 0.047],
      ],
    });

    // Left shin with profiled capsule (calf muscle shape)
    mouldManager.addMould({
      id: "shin-left",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.35, 0],
      radius: 0.5 * 0.08,
      blendRadius: 0.02, // Minimal blend for profiled capsules
      parentJointId: "knee-left",
      radialProfiles: [
        // Control points: 0° (lateral), 45°, 90° (front), 135°, 180° (medial/flat tibia), 225°, 270° (back/calf), 315°
        // Seg 0: Knee - slightly oval, medial flat
        [0.045, 0.046, 0.047, 0.046, 0.042, 0.044, 0.046, 0.046],
        // Seg 1: Upper shin - medial very flat (tibia bone surface), front rounded
        [0.040, 0.041, 0.043, 0.041, 0.035, 0.038, 0.041, 0.041],
        // Seg 2: Mid shin - thinnest, very flat medial surface
        [0.033, 0.034, 0.036, 0.034, 0.028, 0.031, 0.034, 0.034],
        // Seg 3: Calf starts - back begins to bulge, medial still flat
        [0.038, 0.039, 0.041, 0.039, 0.032, 0.038, 0.044, 0.041],
        // Seg 4: Calf max - pronounced bulge at back (270°), medial flat
        [0.042, 0.044, 0.047, 0.044, 0.036, 0.044, 0.053, 0.048],
        // Seg 5: Ankle - slightly oval
        [0.035, 0.036, 0.037, 0.036, 0.033, 0.034, 0.036, 0.036],
      ],
    });

    mouldManager.addMould({
      id: "foot-left",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, 0, 0.12], // To foot tip (horizontal bone)
      radius: 0.5 * 0.06,
      blendRadius: 0.02, // Minimal blend for profiled capsules
      parentJointId: "ankle-left",
      radialProfiles: [
        // Control points: 0° (lateral/right), 45°, 90° (top), 135°, 180° (medial/left), 225°, 270° (bottom), 315°
        // Seg 0: Ankle - narrow, slightly taller than wide
        [0.030, 0.032, 0.035, 0.032, 0.030, 0.032, 0.028, 0.032],
        // Seg 1: Arch - wider at bottom for heel/arch support
        [0.034, 0.035, 0.036, 0.035, 0.034, 0.036, 0.038, 0.036],
        // Seg 2: Midfoot - flatter bottom, wider
        [0.036, 0.037, 0.037, 0.037, 0.036, 0.038, 0.042, 0.038],
        // Seg 3: Ball of foot - slightly wider, flatter bottom
        [0.034, 0.035, 0.035, 0.035, 0.034, 0.036, 0.040, 0.036],
        // Seg 4: Toe area - tapering
        [0.028, 0.029, 0.030, 0.029, 0.028, 0.030, 0.032, 0.030],
        // Seg 5: Toe tip - small and rounded
        [0.022, 0.023, 0.024, 0.023, 0.022, 0.024, 0.025, 0.024],
      ],
    });

    // Right leg chain - thigh with muscle profile
    mouldManager.addMould({
      id: "thigh-right",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.4, 0], // To knee
      radius: 0.5 * 0.1,
      blendRadius: 0.02, // Minimal blend for profiled capsules
      parentJointId: "hip-right",
      radialProfiles: [
        // Control points at angles: 0° (lateral/right), 45°, 90° (front), 135°, 180° (medial/inner), 225°, 270° (back), 315°
        // Seg 0: Hip - fuller, slightly oval (medial slightly flattened)
        [0.055, 0.056, 0.057, 0.056, 0.052, 0.055, 0.058, 0.056],
        // Seg 1: Upper thigh - quads bulge (front 90°), hamstrings (back 270°), medial flat (180°)
        [0.058, 0.060, 0.065, 0.060, 0.052, 0.058, 0.063, 0.060],
        // Seg 2: Mid thigh - maximum quad development, medial flattening
        [0.060, 0.062, 0.068, 0.062, 0.054, 0.060, 0.066, 0.062],
        // Seg 3: Lower mid thigh - starting to taper, medial still flat
        [0.056, 0.058, 0.061, 0.058, 0.051, 0.056, 0.060, 0.058],
        // Seg 4: Above knee - significant taper, medial flattening
        [0.050, 0.052, 0.054, 0.052, 0.047, 0.050, 0.053, 0.052],
        // Seg 5: Knee approach - narrowest, more circular
        [0.046, 0.047, 0.048, 0.047, 0.045, 0.046, 0.047, 0.047],
      ],
    });

    mouldManager.addMould({
      id: "shin-right",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, -0.35, 0],
      radius: 0.5 * 0.08,
      blendRadius: 0.02, // Minimal blend for profiled capsules
      parentJointId: "knee-right",
      radialProfiles: [
        // Control points: 0° (lateral), 45°, 90° (front), 135°, 180° (medial/flat tibia), 225°, 270° (back/calf), 315°
        // Seg 0: Knee - slightly oval, medial flat
        [0.045, 0.046, 0.047, 0.046, 0.042, 0.044, 0.046, 0.046],
        // Seg 1: Upper shin - medial very flat (tibia bone surface), front rounded
        [0.040, 0.041, 0.043, 0.041, 0.035, 0.038, 0.041, 0.041],
        // Seg 2: Mid shin - thinnest, very flat medial surface
        [0.033, 0.034, 0.036, 0.034, 0.028, 0.031, 0.034, 0.034],
        // Seg 3: Calf starts - back begins to bulge, medial still flat
        [0.038, 0.039, 0.041, 0.039, 0.032, 0.038, 0.044, 0.041],
        // Seg 4: Calf max - pronounced bulge at back (270°), medial flat
        [0.042, 0.044, 0.047, 0.044, 0.036, 0.044, 0.053, 0.048],
        // Seg 5: Ankle - slightly oval
        [0.035, 0.036, 0.037, 0.036, 0.033, 0.034, 0.036, 0.036],
      ],
    });

    mouldManager.addMould({
      id: "foot-right",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, 0, 0.12], // To foot tip (horizontal bone)
      radius: 0.5 * 0.06,
      blendRadius: 0.02, // Minimal blend for profiled capsules
      parentJointId: "ankle-right",
      radialProfiles: [
        // Control points: 0° (lateral/right), 45°, 90° (top), 135°, 180° (medial/left), 225°, 270° (bottom), 315°
        // Seg 0: Ankle - narrow, slightly taller than wide
        [0.030, 0.032, 0.035, 0.032, 0.030, 0.032, 0.028, 0.032],
        // Seg 1: Arch - wider at bottom for heel/arch support
        [0.034, 0.035, 0.036, 0.035, 0.034, 0.036, 0.038, 0.036],
        // Seg 2: Midfoot - flatter bottom, wider
        [0.036, 0.037, 0.037, 0.037, 0.036, 0.038, 0.042, 0.038],
        // Seg 3: Ball of foot - slightly wider, flatter bottom
        [0.034, 0.035, 0.035, 0.035, 0.034, 0.036, 0.040, 0.036],
        // Seg 4: Toe area - tapering
        [0.028, 0.029, 0.030, 0.029, 0.028, 0.030, 0.032, 0.030],
        // Seg 5: Toe tip - small and rounded
        [0.022, 0.023, 0.024, 0.023, 0.022, 0.024, 0.025, 0.024],
      ],
    });

    // Notify parent of moulds structure
    if (props.onMouldsReady) {
      const moulds = mouldManager.getMoulds().map((m) => ({
        id: m.id,
        shape: m.shape,
        parentJointId: m.parentJointId,
      }));
      props.onMouldsReady(moulds);
    }

    // Sync skeleton and moulds to Rust backend (immediate)
    scheduleSyncToRustBackend(true);

    isInitialized = true;
  };

  // Create Rust sync scheduler using extracted module
  const { scheduleSync: scheduleSyncToRustBackend } = createRustSyncScheduler(
    () => currentSkeleton,
    () => currentMouldManager
  );

  // Regenerate mesh geometry
  const updateMesh = (lowRes: boolean = false) => {
    if (!sceneMesh) return;

    // Use lower resolution during interaction for responsiveness
    let resolution: number;
    if (lowRes) {
      // Always use 32 during interaction, regardless of target resolution
      resolution = 32;
    } else {
      resolution = props.voxelResolution;
    }
    // Use fast mode (skips Newton projection) during interaction for speed
    const fastMode = lowRes;

    // Call extracted mesh generation module
    void regenerateMeshFromRust(
      sceneMesh,
      resolution,
      fastMode,
      (ready) => { meshReady = ready; },
      updateWireframe
    );
  };

  // Wrapper for skeleton visualization using extracted module
  const createSkeletonVisualizationWrapper = async () => {
    if (!currentScene || !currentSkeleton) return;

    const result = createSkeletonVisualization(
      currentScene,
      currentSkeleton,
      props.selectedJointId,
      props.showSkeleton,
      sceneMesh,
      skeletonGroup,
      jointSpheres
    );

    skeletonGroup = result.group;
    jointSpheres = result.jointSpheres;
  };


  // Wrapper for profile rings visualization using extracted module
  const createProfileRingsVisualizationWrapper = async () => {
    if (!currentScene) return;

    const group = await createProfileRingsVisualization(
      currentScene,
      props.showSkeleton,
      sceneMesh,
      profileRingsGroup
    );

    if (group) {
      profileRingsGroup = group;
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

  // Update mesh when voxel resolution changes
  createEffect(() => {
    props.voxelResolution; // Track the dependency
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

  // Handle profile rings visibility toggle (follows skeleton)
  createEffect(() => {
    if (!profileRingsGroup) return;
    profileRingsGroup.visible = props.showSkeleton;
  });

  // Handle joint selection changes
  createEffect(() => {
    const selected = props.selectedJointId;
    if (!jointSpheres.size) return;

    // Update all joint materials
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const selectedJointMaterial = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
    });

    jointSpheres.forEach((sphere, jointId) => {
      const oldMaterial = sphere.material as THREE.Material;
      sphere.material =
        jointId === selected ? selectedJointMaterial : jointMaterial;
      oldMaterial.dispose();
    });
  });

  // Debounced high-res update
  let upscaleDebounceTimer: number | undefined;
  const debouncedUpscale = () => {
    if (upscaleDebounceTimer) clearTimeout(upscaleDebounceTimer);
    upscaleDebounceTimer = setTimeout(() => {
      scheduleSyncToRustBackend(true);
      updateMesh(false);
      void createSkeletonVisualizationWrapper(); // Update skeleton after interaction
      void createProfileRingsVisualizationWrapper(); // Update profile rings after interaction
    }, 300); // 300ms after last interaction (reduced from 500ms)
  };

  // Throttled low-res updates during drag for responsiveness
  let lowResThrottleTimer: number | undefined;
  const throttledLowResUpdate = () => {
    if (lowResThrottleTimer) return;
    updateMesh(true);
    lowResThrottleTimer = setTimeout(() => {
      lowResThrottleTimer = undefined;
    }, 100) as unknown as number;
  };

  // Handle joint movements
  createEffect(() => {
    const movement = props.jointMovement;
    if (!movement || !currentSkeleton || !sceneMesh || !currentMouldManager)
      return;

    // Check if this is an absolute offset (from slider) or delta movement
    const isAbsolute = (movement as any).absolute;

    if (isAbsolute) {
      // Absolute: SET the joint's local offset directly
      currentSkeleton.setJointLocalOffset(movement.jointId, movement.offset);
    } else {
      // Delta: ADD to current offset (legacy behavior)
      currentSkeleton.moveJoint(movement.jointId, movement.offset);
    }

    // Update skeleton visualization immediately (instant feedback)
    void createSkeletonVisualizationWrapper();
    void createProfileRingsVisualizationWrapper();

    // Sync updated skeleton to Rust backend
    scheduleSyncToRustBackend();

    // Low-res mesh updates during drag, then high-res after pause
    throttledLowResUpdate();
    debouncedUpscale();
  });

  // Handle joint rotations
  createEffect(() => {
    const rotation = props.jointRotation;
    if (!rotation || !currentSkeleton || !sceneMesh || !currentMouldManager)
      return;

    const joint = currentSkeleton.getJoint(rotation.jointId);
    if (!joint) return;

    // Convert euler angles to quaternion
    const quat = eulerToQuat(
      rotation.euler[0],
      rotation.euler[1],
      rotation.euler[2]
    );

    // Check if this is an absolute rotation (from slider) or delta rotation
    const isAbsolute = (rotation as any).absolute;

    if (isAbsolute) {
      // Absolute: SET the rotation directly
      currentSkeleton.setJointLocalRotation(rotation.jointId, quat);
    } else {
      // Delta: MULTIPLY with current rotation (legacy behavior)
      const newRotation = multiplyQuat(joint.localRotation, quat);
      currentSkeleton.setJointLocalRotation(rotation.jointId, newRotation);
    }

    // Update skeleton visualization immediately (instant feedback)
    void createSkeletonVisualizationWrapper();
    void createProfileRingsVisualizationWrapper();

    // Sync updated skeleton to Rust backend
    scheduleSyncToRustBackend();

    // Low-res mesh updates during drag, then high-res after pause
    throttledLowResUpdate();
    debouncedUpscale();
  });

  // Notify parent when joint is selected (provides initial offset/rotation/mouldRadius for sliders)
  let lastNotifiedJointId: string | null = null;

  createEffect(() => {
    const jointId = props.selectedJointId;

    // Only notify if the joint actually changed (not on re-selection)
    if (jointId === lastNotifiedJointId) return;

    if (jointId && currentSkeleton && currentMouldManager && props.onJointSelected) {
      const joint = currentSkeleton.getJoint(jointId);
      if (joint) {
        // Get the first mould attached to this joint to get its radius
        const jointMoulds = currentMouldManager.getMouldsByJoint(jointId);
        const mouldRadius = jointMoulds.length > 0 ? jointMoulds[0].radius : 0.1;

        props.onJointSelected(jointId, joint.localOffset, joint.localRotation, mouldRadius);
        lastNotifiedJointId = jointId;
      }
    }
  });

  // Update mould radius for selected joint's moulds
  createEffect(() => {
    const radius = props.mouldRadius;
    const jointId = props.selectedJointId;

    if (!jointId || !currentMouldManager) return;

    const mouldManager = currentMouldManager;

    // Get all moulds attached to this joint
    const jointMoulds = mouldManager.getMouldsByJoint(jointId);

    if (jointMoulds.length === 0) return;

    // Check if ANY mould actually needs updating
    // Compare against the ACTUAL mould radius, not a cached slider value
    const needsUpdate = jointMoulds.some(mould =>
      Math.abs(mould.radius - radius) > 0.0001
    );

    if (!needsUpdate) {
      // All moulds already have this radius - skip update entirely
      return;
    }

    // Update radius for all moulds on this joint
    jointMoulds.forEach(mould => {
      mouldManager.updateMouldRadius(mould.id, radius);
    });

    // Sync to Rust backend
    scheduleSyncToRustBackend();

    // Low-res mesh updates during drag, then high-res after pause
    throttledLowResUpdate();
    debouncedUpscale();
  });

  // Reusable materials for joint highlighting (created once, reused)
  const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const selectedJointMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });
  let lastSelectedJointId: string | null = null;

  // Update skeleton visualization when selected joint changes
  createEffect(() => {
    const jointId = props.selectedJointId;

    // Only update the materials of the 2 joints that changed (old selected + new selected)
    if (jointSpheres.size > 0) {
      // Deselect previous joint
      if (lastSelectedJointId && lastSelectedJointId !== jointId) {
        const prevSphere = jointSpheres.get(lastSelectedJointId);
        if (prevSphere) {
          prevSphere.material = jointMaterial;
        }
      }

      // Select new joint
      if (jointId) {
        const newSphere = jointSpheres.get(jointId);
        if (newSphere) {
          newSphere.material = selectedJointMaterial;
        }
      }

      lastSelectedJointId = jointId;
    }
  });

  return <ThreeScene onSceneReady={handleSceneReady} />;
}
