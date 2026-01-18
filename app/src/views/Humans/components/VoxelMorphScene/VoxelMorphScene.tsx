import { createEffect, untrack, onCleanup } from "solid-js";
import * as THREE from "three";
import ThreeScene from "../ThreeScene";
import { MouldManager } from "../../morphing/mould-manager";
import { Skeleton } from "../../morphing/skeleton";
import { identityQuat, eulerToQuat, multiplyQuat } from "../../morphing/transform";
import type { VoxelMorphSceneProps } from "./types";
import { createSkeletonVisualization } from "./visualization/skeleton";
import { createProfileRingsVisualization } from "./visualization/profileRings";
import { updateWireframe as updateWireframeVisualization } from "./visualization/wireframe";
import { regenerateMeshFromRust } from "./mesh/generation";
import { createRustSyncScheduler } from "./mesh/rustSync";
import { createCanvasClickHandler } from "./handlers/events";
import { createProfileHandles, updateProfileHandles, type ProfileHandle } from "./visualization/profileHandles";
import { createProfileDragHandler } from "./handlers/profileDrag";

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

  // Profile editing state
  let profileHandlesGroup: THREE.Group | undefined;
  let profileHandles: ProfileHandle[] = [];

  // Debounced mesh update after user stops interacting (defined early for use in handlers)
  let meshUpdateDebounceTimer: number | undefined;
  const debouncedMeshUpdate = () => {
    if (meshUpdateDebounceTimer) clearTimeout(meshUpdateDebounceTimer);
    meshUpdateDebounceTimer = setTimeout(async () => {
      await scheduleSyncToRustBackend(true);
      updateMesh(false);
      void createSkeletonVisualizationWrapper();
      void createProfileRingsVisualizationWrapper();
      // Update profile handles if they exist
      if (profileHandles.length > 0 && currentMouldManager && currentSkeleton) {
        updateProfileHandles(profileHandles, currentMouldManager, currentSkeleton);
      }
    }, 500); // Wait 500ms after last change before regenerating mesh
  };

  // Create canvas click handler using extracted module
  const handleCanvasClick = createCanvasClickHandler(
    () => currentCanvas,
    () => currentCamera,
    () => currentScene,
    () => jointSpheres,
    props.onJointClicked
  );

  // Create profile drag handler
  const profileDragHandler = createProfileDragHandler(
    () => currentCamera,
    () => profileHandles,
    () => currentMouldManager,
    (mouldId, segmentIndex, controlPointIndex, newRadius) => {
      // Update the profile data in the mould manager
      if (!currentMouldManager) return;

      const mould = currentMouldManager.getMould(mouldId);
      if (!mould || !mould.radialProfiles) return;

      // Update the radius value
      mould.radialProfiles[segmentIndex][controlPointIndex] = newRadius;

      // Notify parent component if callback provided
      if (props.onProfileRadiusChange) {
        props.onProfileRadiusChange(mouldId, segmentIndex, controlPointIndex, newRadius);
      }

      // Trigger mesh update (debounced)
      debouncedMeshUpdate();
    }
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

    // Add profile drag event listeners
    const handleMouseDown = (e: MouseEvent) => profileDragHandler.handleMouseDown(e, canvas);
    const handleMouseMove = (e: MouseEvent) => profileDragHandler.handleMouseMove(e, canvas);
    const handleMouseUp = () => profileDragHandler.handleMouseUp();

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);

    // Cleanup listeners on component unmount
    onCleanup(() => {
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
    });

    await initializeSkeletonAndMoulds();
    updateMesh();
    await createSkeletonVisualizationWrapper();
    await createProfileRingsVisualizationWrapper();
    // Snapshot automation disabled - take snapshots manually instead
    // await setupSnapshotWrapper();
  };

  // Snapshot automation disabled - setupSnapshotWrapper function removed
  // Snapshots can be taken manually instead

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

    // Head with profiled capsule (egg/axe-shaped: protruding face, very flat back)
    mouldManager.addMould({
      id: "head",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, 0.1, 0], // Vertical from neck to top of head
      radius: 0.5 * 0.15,
      blendRadius: 0.02,
      parentJointId: "head",
      radialProfiles: [
        // Control points: 0° (right), 45°, 90° (front/face), 135°, 180° (left), 225°, 270° (back/flat), 315°
        // Seg 0: Chin/jaw - narrower, face extends forward, very flat back
        [0.060, 0.065, 0.080, 0.065, 0.060, 0.055, 0.045, 0.055],
        // Seg 1: Lower face/mouth - face still forward, back very flat
        [0.068, 0.072, 0.088, 0.072, 0.068, 0.062, 0.050, 0.062],
        // Seg 2: Mid face/cheekbones - widest front-to-back, very flat back
        [0.074, 0.078, 0.092, 0.078, 0.074, 0.068, 0.054, 0.068],
        // Seg 3: Upper face/forehead - still protruding, back flattens
        [0.076, 0.080, 0.090, 0.080, 0.076, 0.070, 0.056, 0.070],
        // Seg 4: Crown/top of skull - widest sideways, very flat back
        [0.078, 0.082, 0.088, 0.082, 0.078, 0.072, 0.058, 0.072],
        // Seg 5: Top of head - rounds off, back still flat
        [0.074, 0.078, 0.084, 0.078, 0.074, 0.068, 0.056, 0.068],
      ],
    });

    // Neck with profiled capsule (trapezius muscles, narrower at top)
    mouldManager.addMould({
      id: "neck",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, 0.1, 0], // To head joint
      radius: 0.5 * 0.08,
      blendRadius: 0.02,
      parentJointId: "neck",
      radialProfiles: [
        // Control points: 0° (right), 45°, 90° (front), 135°, 180° (left), 225°, 270° (back/trapezius), 315°
        // Seg 0: Base of neck - wider, trapezius muscles
        [0.042, 0.044, 0.040, 0.044, 0.042, 0.046, 0.050, 0.046],
        // Seg 1: Lower neck - still muscular
        [0.040, 0.041, 0.038, 0.041, 0.040, 0.043, 0.046, 0.043],
        // Seg 2: Mid neck - starting to narrow
        [0.038, 0.039, 0.036, 0.039, 0.038, 0.040, 0.042, 0.040],
        // Seg 3: Upper mid neck - narrower
        [0.036, 0.037, 0.034, 0.037, 0.036, 0.038, 0.039, 0.038],
        // Seg 4: Below head - narrow
        [0.034, 0.035, 0.033, 0.035, 0.034, 0.036, 0.037, 0.036],
        // Seg 5: Head connection - narrowest
        [0.033, 0.034, 0.032, 0.034, 0.033, 0.035, 0.036, 0.035],
      ],
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

    // Upper spine with profiled capsule (thoracic region, ribcage)
    mouldManager.addMould({
      id: "spine-upper",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, 0.15, 0], // To chest
      radius: 0.5 * 0.15,
      blendRadius: 0.02,
      parentJointId: "spine-upper",
      radialProfiles: [
        // Control points: 0° (right), 45°, 90° (front), 135°, 180° (left), 225°, 270° (back), 315°
        // Seg 0: Lower thoracic - wider
        [0.078, 0.080, 0.082, 0.080, 0.078, 0.080, 0.084, 0.080],
        // Seg 1: Mid-lower thoracic
        [0.079, 0.081, 0.083, 0.081, 0.079, 0.081, 0.085, 0.081],
        // Seg 2: Mid thoracic - widest part of ribcage
        [0.080, 0.082, 0.084, 0.082, 0.080, 0.082, 0.086, 0.082],
        // Seg 3: Mid-upper thoracic
        [0.079, 0.081, 0.083, 0.081, 0.079, 0.081, 0.085, 0.081],
        // Seg 4: Upper thoracic - narrowing
        [0.077, 0.079, 0.081, 0.079, 0.077, 0.079, 0.083, 0.079],
        // Seg 5: Chest approach
        [0.075, 0.077, 0.079, 0.077, 0.075, 0.077, 0.081, 0.077],
      ],
    });

    // Lower spine with profiled capsule (lumbar region)
    mouldManager.addMould({
      id: "spine-lower",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0, 0.15, 0], // To spine-upper
      radius: 0.5 * 0.16,
      blendRadius: 0.02,
      parentJointId: "spine-lower",
      radialProfiles: [
        // Control points: 0° (right), 45°, 90° (front), 135°, 180° (left), 225°, 270° (back), 315°
        // Seg 0: Pelvis connection - wider
        [0.082, 0.084, 0.086, 0.084, 0.082, 0.084, 0.088, 0.084],
        // Seg 1: Lower lumbar - wide
        [0.081, 0.083, 0.085, 0.083, 0.081, 0.083, 0.087, 0.083],
        // Seg 2: Mid lumbar - widest
        [0.082, 0.084, 0.086, 0.084, 0.082, 0.084, 0.088, 0.084],
        // Seg 3: Upper mid lumbar
        [0.081, 0.083, 0.085, 0.083, 0.081, 0.083, 0.087, 0.083],
        // Seg 4: Upper lumbar - narrowing
        [0.079, 0.081, 0.083, 0.081, 0.079, 0.081, 0.085, 0.081],
        // Seg 5: Thoracic transition
        [0.078, 0.080, 0.082, 0.080, 0.078, 0.080, 0.084, 0.080],
      ],
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

    // Left arm chain - upper arm with muscle profile (biceps/triceps)
    mouldManager.addMould({
      id: "upper-arm-left",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [-0.25, 0, 0], // To elbow
      radius: 0.5 * 0.07,
      blendRadius: 0.02,
      parentJointId: "shoulder-left",
      radialProfiles: [
        // Control points: 0° (outer), 45°, 90° (front/biceps), 135°, 180° (inner), 225°, 270° (back/triceps), 315°
        // Seg 0: Shoulder - fuller, deltoid insertion
        [0.038, 0.040, 0.041, 0.040, 0.037, 0.039, 0.040, 0.040],
        // Seg 1: Upper arm - biceps bulge (front 90°), triceps (back 270°)
        [0.040, 0.042, 0.045, 0.042, 0.038, 0.041, 0.044, 0.042],
        // Seg 2: Mid upper arm - maximum biceps development
        [0.041, 0.043, 0.047, 0.043, 0.039, 0.042, 0.046, 0.043],
        // Seg 3: Lower mid - starting to taper
        [0.038, 0.040, 0.042, 0.040, 0.037, 0.039, 0.041, 0.040],
        // Seg 4: Above elbow - significant taper
        [0.033, 0.034, 0.036, 0.034, 0.032, 0.033, 0.035, 0.034],
        // Seg 5: Elbow approach - narrowest
        [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
      ],
    });

    mouldManager.addMould({
      id: "forearm-left",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [-0.2, 0, 0], // To wrist
      radius: 0.5 * 0.06,
      blendRadius: 0.02,
      parentJointId: "elbow-left",
      radialProfiles: [
        // Control points: 0° (outer), 45°, 90° (top), 135°, 180° (inner), 225°, 270° (bottom), 315°
        // Seg 0: Elbow - slightly wider
        [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
        // Seg 1: Upper forearm - muscle belly
        [0.032, 0.033, 0.034, 0.033, 0.031, 0.032, 0.033, 0.033],
        // Seg 2: Mid forearm - maximum thickness
        [0.033, 0.034, 0.035, 0.034, 0.032, 0.033, 0.034, 0.034],
        // Seg 3: Lower mid forearm - tapering begins
        [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
        // Seg 4: Above wrist - significant taper
        [0.026, 0.027, 0.028, 0.027, 0.025, 0.026, 0.027, 0.027],
        // Seg 5: Wrist approach - narrowest
        [0.022, 0.023, 0.024, 0.023, 0.021, 0.022, 0.023, 0.023],
      ],
    });

    mouldManager.addMould({
      id: "hand-left",
      shape: "sphere",
      center: [-0.04, 0, 0], // Midpoint of hand
      radius: 0.5 * 0.05,
      blendRadius,
      parentJointId: "hand-left",
    });

    // Right arm chain - upper arm with muscle profile (biceps/triceps)
    mouldManager.addMould({
      id: "upper-arm-right",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0.25, 0, 0], // To elbow
      radius: 0.5 * 0.07,
      blendRadius: 0.02,
      parentJointId: "shoulder-right",
      radialProfiles: [
        // Control points: 0° (outer), 45°, 90° (front/biceps), 135°, 180° (inner), 225°, 270° (back/triceps), 315°
        // Seg 0: Shoulder - fuller, deltoid insertion
        [0.038, 0.040, 0.041, 0.040, 0.037, 0.039, 0.040, 0.040],
        // Seg 1: Upper arm - biceps bulge (front 90°), triceps (back 270°)
        [0.040, 0.042, 0.045, 0.042, 0.038, 0.041, 0.044, 0.042],
        // Seg 2: Mid upper arm - maximum biceps development
        [0.041, 0.043, 0.047, 0.043, 0.039, 0.042, 0.046, 0.043],
        // Seg 3: Lower mid - starting to taper
        [0.038, 0.040, 0.042, 0.040, 0.037, 0.039, 0.041, 0.040],
        // Seg 4: Above elbow - significant taper
        [0.033, 0.034, 0.036, 0.034, 0.032, 0.033, 0.035, 0.034],
        // Seg 5: Elbow approach - narrowest
        [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
      ],
    });

    mouldManager.addMould({
      id: "forearm-right",
      shape: "profiled-capsule",
      center: [0, 0, 0],
      endPoint: [0.2, 0, 0], // To wrist
      radius: 0.5 * 0.06,
      blendRadius: 0.02,
      parentJointId: "elbow-right",
      radialProfiles: [
        // Control points: 0° (outer), 45°, 90° (top), 135°, 180° (inner), 225°, 270° (bottom), 315°
        // Seg 0: Elbow - slightly wider
        [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
        // Seg 1: Upper forearm - muscle belly
        [0.032, 0.033, 0.034, 0.033, 0.031, 0.032, 0.033, 0.033],
        // Seg 2: Mid forearm - maximum thickness
        [0.033, 0.034, 0.035, 0.034, 0.032, 0.033, 0.034, 0.034],
        // Seg 3: Lower mid forearm - tapering begins
        [0.030, 0.031, 0.032, 0.031, 0.029, 0.030, 0.031, 0.031],
        // Seg 4: Above wrist - significant taper
        [0.026, 0.027, 0.028, 0.027, 0.025, 0.026, 0.027, 0.027],
        // Seg 5: Wrist approach - narrowest
        [0.022, 0.023, 0.024, 0.023, 0.021, 0.022, 0.023, 0.023],
      ],
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
        // Control points: 0° (lateral/right), 45°, 90° (top), 135°, 180° (medial/left), 225°, 270° (bottom/ground), 315°
        // Seg 0: Heel - narrow at ankle, rounded top, FLAT bottom for ground contact
        [0.032, 0.033, 0.036, 0.033, 0.032, 0.020, 0.015, 0.020],
        // Seg 1: Arch area - rounded top, INDENT at bottom (arch doesn't touch ground)
        [0.036, 0.037, 0.038, 0.037, 0.036, 0.010, 0.005, 0.010],
        // Seg 2: Midfoot/arch transition - still arched but starting to widen
        [0.038, 0.039, 0.039, 0.039, 0.038, 0.012, 0.008, 0.012],
        // Seg 3: Ball of foot - wider, rounded top, FLAT bottom for ground contact
        [0.036, 0.037, 0.037, 0.037, 0.036, 0.018, 0.015, 0.018],
        // Seg 4: Toe area - tapering, flatter bottom
        [0.030, 0.031, 0.032, 0.031, 0.030, 0.016, 0.014, 0.016],
        // Seg 5: Toe tip - small and rounded
        [0.022, 0.023, 0.024, 0.023, 0.022, 0.018, 0.017, 0.018],
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
        // Control points: 0° (lateral/right), 45°, 90° (top), 135°, 180° (medial/left), 225°, 270° (bottom/ground), 315°
        // Seg 0: Heel - narrow at ankle, rounded top, FLAT bottom for ground contact
        [0.032, 0.033, 0.036, 0.033, 0.032, 0.020, 0.015, 0.020],
        // Seg 1: Arch area - rounded top, INDENT at bottom (arch doesn't touch ground)
        [0.036, 0.037, 0.038, 0.037, 0.036, 0.010, 0.005, 0.010],
        // Seg 2: Midfoot/arch transition - still arched but starting to widen
        [0.038, 0.039, 0.039, 0.039, 0.038, 0.012, 0.008, 0.012],
        // Seg 3: Ball of foot - wider, rounded top, FLAT bottom for ground contact
        [0.036, 0.037, 0.037, 0.037, 0.036, 0.018, 0.015, 0.018],
        // Seg 4: Toe area - tapering, flatter bottom
        [0.030, 0.031, 0.032, 0.031, 0.030, 0.016, 0.014, 0.016],
        // Seg 5: Toe tip - small and rounded
        [0.022, 0.023, 0.024, 0.023, 0.022, 0.018, 0.017, 0.018],
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

    // Sync skeleton and moulds to Rust backend (immediate) - await to ensure Rust is ready
    await scheduleSyncToRustBackend(true);

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

    // Defer mesh regeneration until user stops dragging slider
    debouncedMeshUpdate();
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

    // Defer mesh regeneration until user stops dragging slider
    debouncedMeshUpdate();
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
  // ONLY tracks mouldRadius changes, not selectedJointId changes
  createEffect(() => {
    const radius = props.mouldRadius;

    // Use untrack to read selectedJointId without creating a dependency on it
    // This prevents the effect from firing when joints are clicked
    const jointId = untrack(() => props.selectedJointId);

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

    // Defer mesh regeneration until user stops dragging slider
    debouncedMeshUpdate();
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

  // Manage profile handles when profile ring selection changes
  createEffect(() => {
    const selectedRing = props.selectedProfileRing;
    const editMode = props.profileEditMode;

    // Clean up existing handles
    if (profileHandlesGroup && currentScene) {
      currentScene.remove(profileHandlesGroup);
      profileHandlesGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      profileHandlesGroup = undefined;
      profileHandles = [];
    }

    // Create new handles if a ring is selected and edit mode is active
    if (editMode && selectedRing && currentScene && currentMouldManager && currentSkeleton) {
      const { mouldId, segmentIndex } = selectedRing;
      const result = createProfileHandles(
        currentScene,
        mouldId,
        segmentIndex,
        currentMouldManager,
        currentSkeleton
      );

      profileHandlesGroup = result.group;
      profileHandles = result.handles;
    }
  });

  return <ThreeScene onSceneReady={handleSceneReady} />;
}
