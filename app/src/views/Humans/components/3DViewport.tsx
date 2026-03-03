import { createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { initializeDefaultHumanoid, type HumanoidData } from "../morphing/humanoidInit";
import { syncToRustBackend, createRustSyncScheduler } from "../morphing/rustSync";
import { eulerToQuat, multiplyQuat } from "../morphing/transform";
import type { Skeleton } from "../morphing/skeleton";
import type { MouldManager } from "../morphing/mould-manager";
import Icon from "../../../components/Icon";

type ThreeDViewportProps = {
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

  // Humanoid data state
  let humanoidData: HumanoidData | undefined;
  let currentSkeleton: Skeleton | undefined;
  let currentMouldManager: MouldManager | undefined;

  // Orbit camera state
  const [cameraYaw, setCameraYaw] = createSignal(0);
  const [cameraPitch, setCameraPitch] = createSignal(0);
  const [cameraDistance, setCameraDistance] = createSignal(2.0);
  const [gpuInitialized, setGpuInitialized] = createSignal(false);

  // Mouse drag state
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Momentum/inertia state for smooth rotation
  let velocityYaw = 0;
  let velocityPitch = 0;
  let velocityDistance = 0;
  let animationFrameId: number | null = null;

  // Camera update state - prevent overlapping calls
  let cameraUpdatePending = false;
  let pendingCameraState: { yaw: number; pitch: number; distance: number } | null = null;

  // Create Rust sync scheduler
  const { scheduleSync: scheduleSyncToRustBackend } = createRustSyncScheduler(
    () => currentSkeleton,
    () => currentMouldManager
  );

  // Update camera on Rust side with coalescing to prevent flickering
  const updateCamera = async (yaw: number, pitch: number, distance: number) => {
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

  // Animation loop for momentum-based camera movement
  const startMomentumAnimation = () => {
    if (animationFrameId !== null) return;

    const animate = () => {
      const friction = 0.92; // Decay factor (lower = more friction)
      const threshold = 0.0001; // Stop when velocity is negligible

      // Apply friction
      velocityYaw *= friction;
      velocityPitch *= friction;
      velocityDistance *= friction;

      // Check if we should stop animating
      const totalVelocity = Math.abs(velocityYaw) + Math.abs(velocityPitch) + Math.abs(velocityDistance);
      if (totalVelocity < threshold) {
        animationFrameId = null;
        return;
      }

      // Apply velocity to camera state
      const newYaw = cameraYaw() + velocityYaw;
      const newPitch = cameraPitch() + velocityPitch;
      const newDistance = Math.max(0.5, Math.min(10, cameraDistance() + velocityDistance));

      setCameraYaw(newYaw);
      setCameraPitch(newPitch);
      setCameraDistance(newDistance);
      void updateCamera(newYaw, newPitch, newDistance);

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
  };

  // Mouse event handlers for orbit camera
  const handleMouseDown = (e: MouseEvent) => {
    isDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Stop any ongoing momentum animation when user grabs
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    velocityYaw = 0;
    velocityPitch = 0;

    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;

    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Sensitivity for rotation
    const sensitivity = 0.01;

    // Store velocity for momentum
    velocityYaw = deltaX * sensitivity;
    velocityPitch = -deltaY * sensitivity;

    const newYaw = cameraYaw() + velocityYaw;
    const newPitch = cameraPitch() + velocityPitch;

    setCameraYaw(newYaw);
    setCameraPitch(newPitch);
    void updateCamera(newYaw, newPitch, cameraDistance());
  };

  const handleMouseUp = () => {
    if (isDragging) {
      // Start momentum animation if there's velocity
      if (Math.abs(velocityYaw) > 0.001 || Math.abs(velocityPitch) > 0.001) {
        startMomentumAnimation();
      }
    }
    isDragging = false;
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();

    // Zoom sensitivity - apply as velocity for smooth zoom
    const zoomFactor = 0.002;
    velocityDistance = e.deltaY * zoomFactor * cameraDistance();

    // Immediate update plus start momentum for smooth continuation
    const newDistance = Math.max(0.5, Math.min(10, cameraDistance() + velocityDistance));
    setCameraDistance(newDistance);
    void updateCamera(cameraYaw(), cameraPitch(), newDistance);

    // Start momentum animation for smooth zoom decay
    startMomentumAnimation();
  };

  // Helper to trigger GPU render
  const renderToGpu = async () => {
    if (!viewportContentRef) return;

    try {
      const rect = viewportContentRef.getBoundingClientRect();
      const scaleFactor = window.devicePixelRatio || 2;

      if (!gpuInitialized()) {
        await invoke("init_gpu_renderer", {
          viewportX: Math.round(rect.left * scaleFactor),
          viewportY: Math.round(rect.top * scaleFactor),
          viewportWidth: Math.round(rect.width * scaleFactor),
          viewportHeight: Math.round(rect.height * scaleFactor)
        });
        setGpuInitialized(true);
      }

      await invoke("update_gpu_viewport", {
        x: Math.round(rect.left * scaleFactor),
        y: Math.round(rect.top * scaleFactor),
        width: Math.round(rect.width * scaleFactor),
        height: Math.round(rect.height * scaleFactor)
      });

      // Generate mesh using GPU compute shaders and render
      await invoke("generate_and_render_gpu_compute", {
        resolution: props.voxelResolution
      });
    } catch (error) {
      console.error("Failed to render to GPU:", error);
    }
  };

  // Initialize humanoid data and sync to Rust
  const initializeHumanoid = async () => {
    humanoidData = initializeDefaultHumanoid();
    currentSkeleton = humanoidData.skeleton;
    currentMouldManager = humanoidData.mouldManager;

    // Notify parent of skeleton structure
    if (props.onSkeletonReady) {
      props.onSkeletonReady(humanoidData.joints);
    }

    // Notify parent of moulds structure
    if (props.onMouldsReady) {
      props.onMouldsReady(humanoidData.moulds);
    }

    // Sync to Rust backend
    await syncToRustBackend(currentSkeleton, currentMouldManager);

    // Now render to GPU
    await renderToGpu();
  };

  // Re-render when voxel resolution changes
  createEffect(() => {
    // Track resolution as dependency
    const _resolution = props.voxelResolution;
    if (_resolution && gpuInitialized()) {
      // Trigger GPU re-render with new resolution
      void renderToGpu();
    }
  });

  // Handle joint movement from sliders
  createEffect(() => {
    const movement = props.jointMovement;
    if (!movement || !currentSkeleton) return;

    const joint = currentSkeleton.getJoint(movement.jointId);
    if (!joint) return;

    // Check if this is an absolute offset or a delta
    const isAbsolute = (movement as any).absolute === true;

    if (isAbsolute) {
      // Set absolute offset
      currentSkeleton.setJointLocalOffset(movement.jointId, movement.offset);
    } else {
      // Apply delta movement
      currentSkeleton.moveJoint(movement.jointId, movement.offset);
    }

    // Sync to Rust and re-render
    void scheduleSyncToRustBackend(true);
    void renderToGpu();
  });

  // Handle joint rotation from sliders
  createEffect(() => {
    const rotation = props.jointRotation;
    if (!rotation || !currentSkeleton) return;

    const joint = currentSkeleton.getJoint(rotation.jointId);
    if (!joint) return;

    // Check if this is an absolute rotation or a delta
    const isAbsolute = (rotation as any).absolute === true;

    if (isAbsolute) {
      // Set absolute rotation (Euler to Quat)
      const quat = eulerToQuat(rotation.euler[0], rotation.euler[1], rotation.euler[2]);
      currentSkeleton.setJointLocalRotation(rotation.jointId, quat);
    } else {
      // Apply delta rotation
      const deltaQuat = eulerToQuat(rotation.euler[0], rotation.euler[1], rotation.euler[2]);
      const newRotation = multiplyQuat(joint.localRotation, deltaQuat);
      currentSkeleton.setJointLocalRotation(rotation.jointId, newRotation);
    }

    // Sync to Rust and re-render
    void scheduleSyncToRustBackend(true);
    void renderToGpu();
  });

  // Handle joint selection from tree
  createEffect(() => {
    const selectedId = props.selectedJointId;
    if (!selectedId || !currentSkeleton || !currentMouldManager) return;

    const joint = currentSkeleton.getJoint(selectedId);
    if (!joint) return;

    // Find mould associated with this joint (if any)
    const moulds = currentMouldManager.getMoulds();
    const associatedMould = moulds.find(m => m.parentJointId === selectedId);
    const mouldRadius = associatedMould?.radius || 0.5;

    // Notify parent with joint data
    if (props.onJointSelected) {
      props.onJointSelected(
        selectedId,
        joint.localOffset,
        joint.localRotation,
        mouldRadius
      );
    }
  });

  // Initialize GPU renderer on mount
  onMount(async () => {
    // Wait a frame for the ref to be assigned
    await new Promise(resolve => requestAnimationFrame(resolve));

    if (!viewportContentRef) {
      console.error("viewportContentRef not available after waiting");
      return;
    }

    // Initialize humanoid data and GPU renderer
    await initializeHumanoid();
  });

  // Cleanup GPU renderer and animation on unmount
  onCleanup(async () => {
    // Cancel any ongoing momentum animation
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    try {
      await invoke("shutdown_gpu_renderer");
    } catch (error) {
      console.error("Failed to shutdown GPU renderer:", error);
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
        {/* GPU renders directly to the window - this div captures mouse events */}
        <div
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; background: transparent; cursor: grab;"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        />
      </div>
    </div>
  );
};

export default ThreeDViewport;
