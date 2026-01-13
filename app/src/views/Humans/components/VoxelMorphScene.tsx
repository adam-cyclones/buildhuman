import { createEffect, onCleanup, onMount } from "solid-js";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { join } from "@tauri-apps/api/path";
import { mkdir, readDir, remove, writeFile } from "@tauri-apps/plugin-fs";
import ThreeScene from "./ThreeScene";
import { MouldManager } from "../morphing/mould-manager";
import { Skeleton } from "../morphing/skeleton";
import { identityQuat, eulerToQuat, multiplyQuat } from "../morphing/transform";

type VoxelMorphSceneProps = {
  mouldRadius: number;
  voxelResolution: 32 | 48 | 64 | 96 | 128 | 256;
  jointMovement: { jointId: string; offset: [number, number, number] } | null;
  jointRotation: { jointId: string; euler: [number, number, number] } | null;
  showWireframe: boolean;
  showSkeleton: boolean;
  selectedJointId: string | null;
  onSkeletonReady?: (joints: Array<{ id: string; parentId?: string; children: string[] }>) => void;
  onMouldsReady?: (moulds: Array<{ id: string; shape: "sphere" | "capsule"; parentJointId?: string }>) => void;
  onJointSelected?: (jointId: string, offset: [number, number, number], rotation: [number, number, number, number], mouldRadius: number) => void;
  onJointClicked?: (jointId: string) => void;
};

export default function VoxelMorphScene(props: VoxelMorphSceneProps) {
  let sceneMesh: THREE.Mesh | undefined;
  let wireframeMesh: THREE.LineSegments | undefined;
  let skeletonGroup: THREE.Group | undefined;
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
    createSkeletonVisualization();
    await setupSnapshotAutomation();
  };

  // Handle canvas clicks to select joints
  const handleCanvasClick = (event: MouseEvent) => {
    if (!currentCanvas || !currentCamera || !currentScene || jointSpheres.size === 0) return;

    // Calculate mouse position in normalized device coordinates (-1 to +1)
    const rect = currentCanvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    // Create raycaster
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, currentCamera);

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
          if (props.onJointClicked) {
            props.onJointClicked(jointId);
          }
          break;
        }
      }
    }
  };

  const SNAPSHOT_DELAY_MS = 10000;
  const SNAPSHOT_READY_TIMEOUT_MS = 15000;
  const SNAPSHOT_DIR_NAME = "debug-snapshots";

  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForMeshReady = async (timeoutMs: number) => {
    const start = Date.now();
    while (!meshReady && Date.now() - start < timeoutMs) {
      await delay(200);
    }
  };

  const writeSnapshotStatus = async (message: string) => {
    try {
      const snapshotDir = await ensureSnapshotDir();
      const statusPath = await join(snapshotDir, "snapshot-status.txt");
      const payload = `${new Date().toISOString()} ${message}\n`;
      const bytes = new TextEncoder().encode(payload);
      await writeFile(statusPath, bytes);
    } catch (error) {
      console.warn("Failed to write snapshot status:", error);
    }
  };

  const ensureSnapshotDir = async () => {
    const appDataPath = await invoke<string>("get_app_data_path");
    const snapshotDir = await join(appDataPath, SNAPSHOT_DIR_NAME);
    await mkdir(snapshotDir, { recursive: true });
    return snapshotDir;
  };

  const clearOldSnapshots = async (snapshotDir: string, keepPath?: string) => {
    try {
      const entries = await readDir(snapshotDir);
      for (const entry of entries) {
        if (entry.path && entry.name?.endsWith(".png") && entry.path !== keepPath) {
          await remove(entry.path, { recursive: true });
        }
      }
    } catch (error) {
      console.warn("Failed to clear old snapshots:", error);
    }
  };

  const saveSnapshot = async (): Promise<string | null> => {
    if (!currentCanvas) {
      console.warn("Snapshot requested before canvas is ready.");
      return null;
    }

    if (currentRenderer && currentScene && currentCamera) {
      currentRenderer.render(currentScene, currentCamera);
    }

    // Wait for a couple of frames to ensure the WebGL backbuffer is populated.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const blob = await new Promise<Blob | null>((resolve) =>
      currentCanvas?.toBlob((result) => resolve(result), "image/png")
    );
    if (!blob) {
      console.warn("Failed to capture canvas snapshot.");
      return null;
    }

    const snapshotDir = await ensureSnapshotDir();
    await clearOldSnapshots(snapshotDir);

    const filename = `snapshot-${Date.now()}.png`;
    const filePath = await join(snapshotDir, filename);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await writeFile(filePath, bytes);
    await clearOldSnapshots(snapshotDir, filePath);
    return filePath;
  };

  const captureAndEmitSnapshot = async (source: "auto" | "request") => {
    try {
      await writeSnapshotStatus(`capture start source=${source} meshReady=${meshReady}`);
      await waitForMeshReady(SNAPSHOT_READY_TIMEOUT_MS);
      const filePath = await saveSnapshot();
      if (filePath) {
        await emit("snapshot-done", { path: filePath, source });
        await writeSnapshotStatus(`capture done source=${source} path=${filePath}`);
      } else {
        await emit("snapshot-done", "");
        await writeSnapshotStatus(`capture done source=${source} path=empty`);
      }
    } catch (error) {
      console.error("Snapshot capture failed:", error);
      await emit("snapshot-done", "");
      await writeSnapshotStatus(`capture failed source=${source}`);
    }
  };

  const setupSnapshotAutomation = async () => {
    if (!import.meta.env.DEV || snapshotInitialized) {
      return;
    }
    snapshotInitialized = true;
    await writeSnapshotStatus(`automation initialized dev=${import.meta.env.DEV}`);

    snapshotTimeoutId = window.setTimeout(() => {
      void captureAndEmitSnapshot("auto");
    }, SNAPSHOT_DELAY_MS);

    snapshotListener = await listen("request-snapshot", async () => {
      await delay(SNAPSHOT_DELAY_MS);
      await captureAndEmitSnapshot("request");
    });

    onCleanup(() => {
      if (snapshotTimeoutId !== undefined) {
        clearTimeout(snapshotTimeoutId);
      }
      if (snapshotListener) {
        snapshotListener();
      }
    });
  };

  onMount(() => {
    void setupSnapshotAutomation();
  });

  // ----------------------------------------------------------------
  // --- RUST MIGRATION: NEW MESH GENERATION FROM BACKEND
  // ----------------------------------------------------------------
  async function regenerateMeshFromRust(resolution: number = 32, fastMode: boolean = false) {
    if (!sceneMesh) return;

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

      meshReady = geometry.attributes.position.count > 0;

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
  }

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
      const moulds = mouldManager.getMoulds().map((m) => ({
        id: m.id,
        shape: m.shape,
        parentJointId: m.parentJointId,
      }));
      props.onMouldsReady(moulds);
    }

    // Sync skeleton and moulds to Rust backend
    await syncToRustBackend();

    isInitialized = true;
  };

  // Sync current skeleton and moulds to Rust backend
  const syncToRustBackend = async () => {
    if (!currentSkeleton || !currentMouldManager) {
      console.warn(
        "Cannot sync to Rust: skeleton or mould manager not initialized"
      );
      return;
    }

    try {
      // Convert skeleton to serializable format
      const joints = currentSkeleton.getJoints().map((j) => ({
        id: j.id,
        local_offset: {
          x: j.localOffset[0],
          y: j.localOffset[1],
          z: j.localOffset[2],
        },
        local_rotation: {
          x: j.localRotation[0],
          y: j.localRotation[1],
          z: j.localRotation[2],
          w: j.localRotation[3],
        },
        parent_id: j.parentId,
        children: j.children,
      }));

      // Convert moulds to serializable format
      const moulds = currentMouldManager.getMoulds().map((m) => ({
        id: m.id,
        shape: m.shape.charAt(0).toUpperCase() + m.shape.slice(1), // Capitalize for Rust enum
        center: {
          x: m.center[0],
          y: m.center[1],
          z: m.center[2],
        },
        radius: m.radius,
        blend_radius: m.blendRadius,
        parent_joint_id: m.parentJointId,
        end_point: m.endPoint
          ? {
              x: m.endPoint[0],
              y: m.endPoint[1],
              z: m.endPoint[2],
            }
          : null,
      }));

      // Send to Rust backend
      await invoke("update_skeleton", { joints });
      await invoke("update_moulds", { moulds });
    } catch (e) {
      console.error("Error syncing to Rust backend:", e);
    }
  };

  // Regenerate mesh geometry
  const updateMesh = (lowRes: boolean = false) => {
    // Use lower resolution during interaction for responsiveness
    // VERY aggressive: use fixed 32 resolution during interaction for butter-smooth response
    let resolution: number;
    if (lowRes) {
      // Always use 32 during interaction, regardless of target resolution
      resolution = 32;
    } else {
      resolution = props.voxelResolution;
    }
    // Use fast mode (skips Newton projection) during interaction for speed
    const fastMode = lowRes;
    regenerateMeshFromRust(resolution, fastMode);

    /*
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
    */
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

    wireframeMesh = new THREE.LineSegments(
      wireframeGeometry,
      wireframeMaterial
    );
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
            child.material.forEach((m) => m.dispose());
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
    const boneMaterial = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      linewidth: 2,
    });
    const jointMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const selectedJointMaterial = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
    });
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
          new THREE.Vector3(worldPos[0], worldPos[1], worldPos[2]),
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
      updateMesh(false);
      createSkeletonVisualization(); // Update skeleton after interaction
    }, 300); // 300ms after last interaction (reduced from 500ms)
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
    createSkeletonVisualization();

    // Sync updated skeleton to Rust backend
    syncToRustBackend();

    // Debounce mesh regeneration - only update after user stops dragging
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
    createSkeletonVisualization();

    // Sync updated skeleton to Rust backend
    syncToRustBackend();

    // Debounce mesh regeneration - only update after user stops dragging
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
    syncToRustBackend();

    // Regenerate mesh with updated radii
    updateMesh(false);
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
