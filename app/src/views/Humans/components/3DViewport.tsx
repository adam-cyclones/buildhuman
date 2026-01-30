import { createSignal, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import VoxelMorphScene from "./VoxelMorphScene";
import Icon from "../../../components/Icon";

type ThreeDViewportProps = {
  renderMode: string;
  onAddHuman: () => void;
  mouldRadius: number;
  voxelResolution: 32 | 48 | 64 | 96 | 128 | 256;
  jointMovement: { jointId: string; offset: [number, number, number] } | null;
  jointRotation: { jointId: string; euler: [number, number, number] } | null;
  showSkeleton: boolean;
  selectedJointId: string | null;
  onSkeletonReady?: (joints: Array<{ id: string; parentId?: string; children: string[] }>) => void;
  onMouldsReady?: (moulds: Array<{ id: string; shape: "sphere" | "capsule" | "profiled-capsule"; parentJointId?: string }>) => void;
  onJointSelected?: (jointId: string, offset: [number, number, number], rotation: [number, number, number, number], mouldRadius: number) => void;
  onJointClicked?: (jointId: string) => void;
}

const ThreeDViewport = (props: ThreeDViewportProps) => {
  const [showWireframe, setShowWireframe] = createSignal(false);
  let viewportContentRef: HTMLDivElement | undefined;

  // TEMPORARY: Enable profile editing for testing
  const [profileEditMode] = createSignal(true);
  const [selectedProfileRing, setSelectedProfileRing] = createSignal<{mouldId: string; segmentIndex: number} | null>(null);

  // Orbit camera state
  const [cameraYaw, setCameraYaw] = createSignal(0);
  const [cameraPitch, setCameraPitch] = createSignal(0);
  const [cameraDistance, setCameraDistance] = createSignal(2.0);

  // Mouse drag state
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Camera update state - prevent overlapping calls
  let cameraUpdatePending = false;
  let pendingCameraState: { yaw: number; pitch: number; distance: number } | null = null;

  // Handle profile ring selection (now managed entirely within viewport)
  const handleProfileRingClicked = (mouldId: string, segmentIndex: number) => {
    setSelectedProfileRing({ mouldId, segmentIndex });
  };

  // Update camera on Rust side with coalescing to prevent flickering
  const updateCamera = async (yaw: number, pitch: number, distance: number) => {
    if (props.renderMode !== "gpu") return;

    // Store the latest state
    pendingCameraState = { yaw, pitch, distance };

    // If an update is already in flight, let it pick up the new state when done
    if (cameraUpdatePending) return;

    cameraUpdatePending = true;

    try {
      while (pendingCameraState) {
        const state = pendingCameraState;
        pendingCameraState = null;
        await invoke("update_gpu_camera", state);
      }
    } catch (error) {
      console.error("Failed to update camera:", error);
    } finally {
      cameraUpdatePending = false;
    }
  };

  // Mouse event handlers for orbit camera
  const handleMouseDown = (e: MouseEvent) => {
    if (props.renderMode !== "gpu") return;
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || props.renderMode !== "gpu") return;

    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Sensitivity for rotation
    const sensitivity = 0.01;

    const newYaw = cameraYaw() + deltaX * sensitivity;
    const newPitch = cameraPitch() - deltaY * sensitivity;

    // Clamp pitch to avoid gimbal lock
    const clampedPitch = Math.max(-1.5, Math.min(1.5, newPitch));

    setCameraYaw(newYaw);
    setCameraPitch(clampedPitch);
    void updateCamera(newYaw, clampedPitch, cameraDistance());
  };

  const handleMouseUp = () => {
    isDragging = false;
  };

  const handleWheel = (e: WheelEvent) => {
    if (props.renderMode !== "gpu") return;
    e.preventDefault();

    // Zoom sensitivity
    const zoomFactor = 0.001;
    const newDistance = cameraDistance() + e.deltaY * zoomFactor * cameraDistance();

    // Clamp distance
    const clampedDistance = Math.max(0.5, Math.min(10, newDistance));

    setCameraDistance(clampedDistance);
    void updateCamera(cameraYaw(), cameraPitch(), clampedDistance);
  };

  // GPU renderer is initialized in Rust's setup() - just update viewport bounds here
  onMount(async () => {
    if (props.renderMode === "gpu") {
      // Wait a frame for the ref to be assigned
      await new Promise(resolve => requestAnimationFrame(resolve));

      if (!viewportContentRef) {
        console.error("viewportContentRef not available after waiting");
        return;
      }

      try {
        const rect = viewportContentRef.getBoundingClientRect();
        const scaleFactor = window.devicePixelRatio || 2;

        await invoke("update_gpu_viewport", {
          x: Math.round(rect.left * scaleFactor),
          y: Math.round(rect.top * scaleFactor),
          width: Math.round(rect.width * scaleFactor),
          height: Math.round(rect.height * scaleFactor)
        });

        // Generate mesh from moulds and render to GPU
        await invoke("generate_and_render_gpu", {
          resolution: props.voxelResolution,
          fastMode: props.voxelResolution >= 96  // Use fast mode for higher resolutions
        });
      } catch (error) {
        console.error("Failed to render to GPU:", error);
      }
    }
  });

  // Cleanup GPU renderer on unmount
  onCleanup(async () => {
    if (props.renderMode === "gpu") {
      try {
        await invoke("shutdown_gpu_renderer");
      } catch (error) {
        console.error("Failed to shutdown GPU renderer:", error);
      }
    }
  });

  return (
    <div class="viewport">
      <div class="left-toolbar">
        <button class="tool-btn" title="Add Human" onClick={props.onAddHuman}>
          <Icon name="plus" size={24} />
        </button>
        <button class="tool-btn" title="Move">
          <Icon name="move" size={24} />
        </button>
      </div>
      <div class="viewport-header">
        <div class="viewport-tabs">
          <div class="viewport-tab active">3D View</div>
          <div class="viewport-tab">UV Editor</div>
        </div>
        <div class="viewport-tools">
          <button
            class="tool-btn"
            title="Toggle Wireframe"
            onClick={() => setShowWireframe(!showWireframe())}
            style={{
              background: showWireframe() ? 'rgba(255, 255, 255, 0.2)' : 'transparent'
            }}
          >
            ⬡
          </button>
          <button class="tool-btn">◎</button>
          <button class="tool-btn">↻</button>
          <button class="tool-btn">⊞</button>
        </div>
      </div>
      <div class="viewport-content" ref={viewportContentRef}>
        {props.renderMode === "cpu" ? (
          <VoxelMorphScene
            mouldRadius={props.mouldRadius}
            voxelResolution={props.voxelResolution}
            jointMovement={props.jointMovement}
            jointRotation={props.jointRotation}
            showWireframe={showWireframe()}
            showSkeleton={props.showSkeleton}
            selectedJointId={props.selectedJointId}
            profileEditMode={profileEditMode()}
            selectedProfileRing={selectedProfileRing()}
            onSkeletonReady={props.onSkeletonReady}
            onMouldsReady={props.onMouldsReady}
            onJointSelected={props.onJointSelected}
            onJointClicked={props.onJointClicked}
            onProfileRingClicked={handleProfileRingClicked}
          />
        ) : (
          <div
            style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; background: transparent; cursor: grab;"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          />
        )}
      </div>
    </div>
  );
};

export default ThreeDViewport;
