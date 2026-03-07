import { createSignal, createEffect, on, onMount, onCleanup } from "solid-js";
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
  selectionHighlight?: { mode: "bone" | "shape" | "region"; value: string } | null;
  activeProfileSegmentIndex?: number | null;
  mouldProfilesVersion?: number;
  onSkeletonReady?: (joints: Array<{ id: string; parentId?: string; children: string[] }>) => void;
  onMouldsReady?: (moulds: Array<{ id: string; shape: "sphere" | "capsule" | "profiled-capsule"; parentJointId?: string }>) => void;
  onMouldManagerReady?: (manager: MouldManager) => void;
  onJointSelected?: (jointId: string, offset: [number, number, number], rotation: [number, number, number, number], mouldRadius: number) => void;
  onJointClicked?: (jointId: string) => void;
  onBoneClicked?: (parentId: string, childId: string) => void;
}

const ThreeDViewport = (props: ThreeDViewportProps) => {
  const [showWireframe, setShowWireframe] = createSignal(false);
  const [showSkeletonLocal, setShowSkeletonLocal] = createSignal(true);
  let viewportContentRef: HTMLDivElement | undefined;

  // Humanoid data state
  let humanoidData: HumanoidData | undefined;
  let currentSkeleton: Skeleton | undefined;
  let currentMouldManager: MouldManager | undefined;

  // Orbit camera state
  const [cameraYaw, setCameraYaw] = createSignal(0);
  const [cameraPitch, setCameraPitch] = createSignal(0);
  const [cameraDistance, setCameraDistance] = createSignal(2.0);
  const [cameraTarget, setCameraTarget] = createSignal<[number, number, number]>([0, 0.3, 0]);
  const [gpuInitialized, setGpuInitialized] = createSignal(false);
  const MAX_CAMERA_PITCH = Math.PI * 0.49;
  const PITCH_BRAKE_ZONE = 0.22;
  const clampPitch = (pitch: number) => Math.max(-MAX_CAMERA_PITCH, Math.min(MAX_CAMERA_PITCH, pitch));
  const normalizeWheelDelta = (delta: number, deltaMode: number) => {
    // Wheel events may arrive in lines/pages instead of pixels.
    if (deltaMode === 1) return delta * 16;
    if (deltaMode === 2) return delta * window.innerHeight;
    return delta;
  };
  const compressTrackpadDelta = (deltaPixels: number) => {
    // Compress OS acceleration spikes while preserving fine control near zero.
    const normalized = Math.tanh(deltaPixels / 48) * 48;
    return normalized;
  };
  const applyPitchDeltaWithMagneticBraking = (deltaPitch: number) => {
    const currentPitch = cameraPitch();
    const distanceToEdge = MAX_CAMERA_PITCH - Math.abs(currentPitch);
    const movingTowardEdge = currentPitch * deltaPitch > 0;
    let easedDelta = deltaPitch;

    // Magnetic braking near cap: apply stronger non-linear slowdown only
    // when motion heads toward the cap. Motion away from the cap stays responsive.
    if (movingTowardEdge && Math.abs(currentPitch) > 0.03 && distanceToEdge < PITCH_BRAKE_ZONE) {
      const t = Math.max(0, Math.min(1, distanceToEdge / PITCH_BRAKE_ZONE));
      const brakeFactor = 0.08 + 0.92 * (t * t);
      easedDelta *= brakeFactor;
    }

    return clampPitch(currentPitch + easedDelta);
  };

  // Mouse drag state
  let isDragging = false;
  let dragMode: "orbit" | "pan" | "zoom" | null = null;
  let lastMouseX = 0;
  let lastMouseY = 0;

  // Momentum/inertia state for smooth rotation
  let velocityYaw = 0;
  let velocityPitch = 0;
  let velocityDistance = 0;
  let animationFrameId: number | null = null;
  let leftPointerDown = false;
  let leftPointerDownX = 0;
  let leftPointerDownY = 0;

  // Camera update state - prevent overlapping calls
  let cameraUpdatePending = false;
  let pendingCameraState: { yaw: number; pitch: number; distance: number; targetX: number; targetY: number; targetZ: number } | null = null;

  // Create Rust sync scheduler
  const { scheduleSync: scheduleSyncToRustBackend } = createRustSyncScheduler(
    () => currentSkeleton,
    () => currentMouldManager
  );

  // Update camera on Rust side with coalescing to prevent flickering
  const updateCamera = async (yaw: number, pitch: number, distance: number, target: [number, number, number]) => {
    // Store the latest state
    pendingCameraState = {
      yaw,
      pitch,
      distance,
      targetX: target[0],
      targetY: target[1],
      targetZ: target[2]
    };

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
      const newPitch = applyPitchDeltaWithMagneticBraking(velocityPitch);
      const newDistance = Math.max(0.5, Math.min(10, cameraDistance() + velocityDistance));
      const target = cameraTarget();

      setCameraYaw(newYaw);
      setCameraPitch(newPitch);
      setCameraDistance(newDistance);
      void updateCamera(newYaw, newPitch, newDistance, target);

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
  };

  // Mouse event handlers for orbit camera
  const handleMouseDown = (e: MouseEvent) => {
    if (e.button === 0) {
      leftPointerDown = true;
      leftPointerDownX = e.clientX;
      leftPointerDownY = e.clientY;
      return;
    }

    // Blender-style mouse controls: camera only on middle mouse drag.
    // This leaves left click available for selection/other interactions.
    if (e.button !== 1) return;

    isDragging = true;
    dragMode = e.shiftKey ? "pan" : (e.ctrlKey || e.metaKey) ? "zoom" : "orbit";
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    // Stop any ongoing momentum animation when user grabs
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    velocityYaw = 0;
    velocityPitch = 0;
    velocityDistance = 0;

    e.preventDefault();
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !dragMode) return;

    const deltaX = e.clientX - lastMouseX;
    const deltaY = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    if (dragMode === "orbit") {
      // Sensitivity for rotation
      const sensitivity = 0.01;

      // Store velocity for momentum
      velocityYaw = deltaX * sensitivity;
      velocityPitch = -deltaY * sensitivity;

      const newYaw = cameraYaw() + velocityYaw;
      const newPitch = applyPitchDeltaWithMagneticBraking(velocityPitch);

      setCameraYaw(newYaw);
      setCameraPitch(newPitch);
      void updateCamera(newYaw, newPitch, cameraDistance(), cameraTarget());
      return;
    }

    if (dragMode === "zoom") {
      // Blender-like Ctrl/Cmd+MMB drag zoom
      const zoomFactor = 0.01;
      velocityDistance = deltaY * zoomFactor * cameraDistance();
      const newDistance = Math.max(0.5, Math.min(10, cameraDistance() + velocityDistance));
      setCameraDistance(newDistance);
      void updateCamera(cameraYaw(), cameraPitch(), newDistance, cameraTarget());
      return;
    }

    // Shift+MMB pan in camera screen-space
    const yaw = cameraYaw();
    const pitch = cameraPitch();
    const distance = cameraDistance();
    const [targetX, targetY, targetZ] = cameraTarget();

    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    const rightX = cosYaw;
    const rightY = 0;
    const rightZ = -sinYaw;
    const upX = sinPitch * sinYaw;
    const upY = cosPitch;
    const upZ = sinPitch * cosYaw;

    const panScale = 0.003 * distance;
    const moveX = -deltaX * panScale;
    const moveY = deltaY * panScale;

    const nextTarget: [number, number, number] = [
      targetX + rightX * moveX + upX * moveY,
      targetY + rightY * moveX + upY * moveY,
      targetZ + rightZ * moveX + upZ * moveY
    ];
    setCameraTarget(nextTarget);
    void updateCamera(yaw, pitch, distance, nextTarget);
  };

  const handleMouseUp = () => {
    leftPointerDown = false;
    if (isDragging) {
      // Start momentum animation if there's velocity
      if (Math.abs(velocityYaw) > 0.001 || Math.abs(velocityPitch) > 0.001 || Math.abs(velocityDistance) > 0.001) {
        startMomentumAnimation();
      }
    }
    isDragging = false;
    dragMode = null;
  };

  const handleViewportClick = (e: MouseEvent) => {
    if (!leftPointerDown || isDragging || !viewportContentRef || !currentSkeleton) return;

    const moved = Math.hypot(e.clientX - leftPointerDownX, e.clientY - leftPointerDownY);
    if (moved > 4) return;

    const rect = viewportContentRef.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const aspect = rect.width / rect.height;
    const yaw = cameraYaw();
    const pitch = cameraPitch();
    const distance = cameraDistance();
    const [targetX, targetY, targetZ] = cameraTarget();

    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);

    const eyeX = targetX + distance * cosPitch * sinYaw;
    const eyeY = targetY + distance * sinPitch;
    const eyeZ = targetZ + distance * cosPitch * cosYaw;

    const forwardX = targetX - eyeX;
    const forwardY = targetY - eyeY;
    const forwardZ = targetZ - eyeZ;
    const forwardLen = Math.hypot(forwardX, forwardY, forwardZ) || 1;
    const fx = forwardX / forwardLen;
    const fy = forwardY / forwardLen;
    const fz = forwardZ / forwardLen;

    const rightX = cosYaw;
    const rightY = 0;
    const rightZ = -sinYaw;
    const upX = fy * rightZ - fz * rightY;
    const upY = fz * rightX - fx * rightZ;
    const upZ = fx * rightY - fy * rightX;

    const halfHeight = distance * 0.5;
    const halfWidth = halfHeight * aspect;

    const worldToScreen = (p: [number, number, number]) => {
      const dx = p[0] - eyeX;
      const dy = p[1] - eyeY;
      const dz = p[2] - eyeZ;
      const nx = (dx * rightX + dy * rightY + dz * rightZ) / halfWidth;
      const ny = (dx * upX + dy * upY + dz * upZ) / halfHeight;
      return {
        x: rect.left + ((nx + 1) * 0.5) * rect.width,
        y: rect.top + ((1 - ny) * 0.5) * rect.height,
      };
    };

    const px = e.clientX;
    const py = e.clientY;
    const joints = currentSkeleton.getJoints();

    let closestJoint: { id: string; dist: number } | null = null;
    for (const j of joints) {
      const wp = currentSkeleton.getWorldPosition(j.id);
      const sp = worldToScreen(wp);
      const d = Math.hypot(sp.x - px, sp.y - py);
      if (!closestJoint || d < closestJoint.dist) {
        closestJoint = { id: j.id, dist: d };
      }
    }

    const JOINT_PICK_RADIUS_PX = 16;
    if (closestJoint && closestJoint.dist <= JOINT_PICK_RADIUS_PX) {
      props.onJointClicked?.(closestJoint.id);
      return;
    }

    const pointSegmentDistance = (
      ptx: number,
      pty: number,
      ax: number,
      ay: number,
      bx: number,
      by: number,
    ) => {
      const abx = bx - ax;
      const aby = by - ay;
      const apx = ptx - ax;
      const apy = pty - ay;
      const abLenSq = abx * abx + aby * aby;
      if (abLenSq < 1e-6) return Math.hypot(apx, apy);
      const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
      const qx = ax + abx * t;
      const qy = ay + aby * t;
      return Math.hypot(ptx - qx, pty - qy);
    };

    let closestBone: { parentId: string; childId: string; dist: number } | null = null;
    for (const child of joints) {
      if (!child.parentId) continue;
      const parent = currentSkeleton.getJoint(child.parentId);
      if (!parent) continue;
      const a = worldToScreen(currentSkeleton.getWorldPosition(parent.id));
      const b = worldToScreen(currentSkeleton.getWorldPosition(child.id));
      const d = pointSegmentDistance(px, py, a.x, a.y, b.x, b.y);
      if (!closestBone || d < closestBone.dist) {
        closestBone = { parentId: parent.id, childId: child.id, dist: d };
      }
    }

    const BONE_PICK_RADIUS_PX = 10;
    if (closestBone && closestBone.dist <= BONE_PICK_RADIUS_PX) {
      props.onBoneClicked?.(closestBone.parentId, closestBone.childId);
    }
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const deltaX = compressTrackpadDelta(normalizeWheelDelta(e.deltaX, e.deltaMode));
    const deltaY = compressTrackpadDelta(normalizeWheelDelta(e.deltaY, e.deltaMode));

    // Trackpad/scroll behavior:
    // - No modifier: orbit (Blender-like trackpad fallback)
    // - Shift: pan
    // - Ctrl/Cmd: zoom
    if (e.shiftKey) {
      const yaw = cameraYaw();
      const pitch = cameraPitch();
      const distance = cameraDistance();
      const [targetX, targetY, targetZ] = cameraTarget();

      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);

      // Camera basis vectors in world space for screen-space panning
      const rightX = cosYaw;
      const rightY = 0;
      const rightZ = -sinYaw;
      const upX = sinPitch * sinYaw;
      const upY = cosPitch;
      const upZ = sinPitch * cosYaw;

      const panScale = 0.0015 * distance;
      const moveX = -deltaX * panScale;
      const moveY = deltaY * panScale;

      const nextTarget: [number, number, number] = [
        targetX + rightX * moveX + upX * moveY,
        targetY + rightY * moveX + upY * moveY,
        targetZ + rightZ * moveX + upZ * moveY
      ];
      setCameraTarget(nextTarget);
      void updateCamera(yaw, pitch, distance, nextTarget);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      // Zoom sensitivity - apply as velocity for smooth zoom
      const zoomFactor = 0.002;
      velocityDistance = deltaY * zoomFactor * cameraDistance();

      // Immediate update plus start momentum for smooth continuation
      const newDistance = Math.max(0.5, Math.min(10, cameraDistance() + velocityDistance));
      setCameraDistance(newDistance);
      void updateCamera(cameraYaw(), cameraPitch(), newDistance, cameraTarget());

      // Start momentum animation for smooth zoom decay
      startMomentumAnimation();
      return;
    }

    // Default: orbit from two-finger trackpad movement
    const orbitSensitivity = 0.006;
    const nextVelocityYaw = deltaX * orbitSensitivity;
    const nextVelocityPitch = deltaY * orbitSensitivity;

    // Trackpad orbit should be direct, not inertial, to avoid direction wobble
    // from OS scroll acceleration/deceleration tails.
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    velocityYaw = 0;
    velocityPitch = 0;

    const newYaw = cameraYaw() + nextVelocityYaw;
    const newPitch = applyPitchDeltaWithMagneticBraking(nextVelocityPitch);
    setCameraYaw(newYaw);
    setCameraPitch(newPitch);
    void updateCamera(newYaw, newPitch, cameraDistance(), cameraTarget());
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

    // Share mould manager reference so parent can mutate profiles
    if (props.onMouldManagerReady) {
      props.onMouldManagerReady(humanoidData.mouldManager);
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

  // Re-sync and re-render when mould profiles are edited externally
  createEffect(on(
    () => props.mouldProfilesVersion,
    () => {
      if (gpuInitialized()) {
        void scheduleSyncToRustBackend(true);
        void renderToGpu();
      }
    },
    { defer: true }
  ));

  // Update selection heatmap in debug skeleton overlay.
  createEffect(on(
    () => [gpuInitialized(), props.selectedJointId, props.selectionHighlight, props.activeProfileSegmentIndex] as const,
    ([ready, selectedId, highlight, activeProfileSegmentIndex]) => {
      if (!ready) return;
      void invoke("set_debug_selection", {
        selectedJointId: selectedId,
        highlightMode: highlight?.mode ?? null,
        highlightValue: highlight?.value ?? null,
        selectedProfileSegmentIndex: activeProfileSegmentIndex ?? null
      });
    },
    { defer: true }
  ));

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
            title="Toggle Skeleton"
            onClick={async () => {
              const next = !showSkeletonLocal();
              setShowSkeletonLocal(next);
              if (gpuInitialized()) {
                await invoke("set_skeleton_visible", { visible: next });
              }
            }}
            style={{
              background: showSkeletonLocal() ? 'rgba(255, 255, 255, 0.2)' : 'transparent'
            }}
          >
            <Icon name="user" size={16} />
          </button>
          <button
            class="tool-btn"
            title="Toggle Wireframe"
            onClick={async () => {
              const next = !showWireframe();
              setShowWireframe(next);
              if (gpuInitialized()) {
                await invoke("set_wireframe_mode", { enabled: next });
              }
            }}
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
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; background: transparent; cursor: default;"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleViewportClick}
          onWheel={handleWheel}
        />
      </div>
    </div>
  );
};

export default ThreeDViewport;
