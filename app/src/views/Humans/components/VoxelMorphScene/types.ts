import type * as THREE from "three";
import type { Skeleton } from "../../morphing/skeleton";
import type { MouldManager } from "../../morphing/mould-manager";

export type VoxelMorphSceneProps = {
  mouldRadius: number;
  voxelResolution: 32 | 48 | 64 | 96 | 128 | 256;
  jointMovement: { jointId: string; offset: [number, number, number] } | null;
  jointRotation: { jointId: string; euler: [number, number, number] } | null;
  showWireframe: boolean;
  showSkeleton: boolean;
  selectedJointId: string | null;
  onSkeletonReady?: (joints: Array<{ id: string; parentId?: string; children: string[] }>) => void;
  onMouldsReady?: (moulds: Array<{ id: string; shape: "sphere" | "capsule" | "profiled-capsule"; parentJointId?: string }>) => void;
  onJointSelected?: (jointId: string, offset: [number, number, number], rotation: [number, number, number, number], mouldRadius: number) => void;
  onJointClicked?: (jointId: string) => void;
};

export type SceneState = {
  scene: THREE.Scene;
  mesh: THREE.Mesh;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  wireframeMesh?: THREE.LineSegments;
  skeletonGroup?: THREE.Group;
  profileRingsGroup?: THREE.Group;
  jointSpheres: Map<string, THREE.Mesh>;
  skeleton?: Skeleton;
  mouldManager?: MouldManager;
  isInitialized: boolean;
  meshReady: boolean;
};

export type SnapshotState = {
  listener?: () => void;
  timeoutId?: number;
  initialized: boolean;
};
