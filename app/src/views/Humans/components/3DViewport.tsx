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

  // Handle profile ring selection (now managed entirely within viewport)
  const handleProfileRingClicked = (mouldId: string, segmentIndex: number) => {
    console.log("3DViewport: Profile ring clicked", mouldId, segmentIndex);
    setSelectedProfileRing({ mouldId, segmentIndex });
  };

  // GPU renderer is initialized in Rust's setup() - just update viewport bounds here
  onMount(async () => {
    if (props.renderMode === "gpu" && viewportContentRef) {
      try {
        const rect = viewportContentRef.getBoundingClientRect();
        const scaleFactor = window.devicePixelRatio || 2;

        console.log("Updating GPU viewport bounds:", {
          x: Math.round(rect.left * scaleFactor),
          y: Math.round(rect.top * scaleFactor),
          width: Math.round(rect.width * scaleFactor),
          height: Math.round(rect.height * scaleFactor)
        });

        await invoke("update_gpu_viewport", {
          x: Math.round(rect.left * scaleFactor),
          y: Math.round(rect.top * scaleFactor),
          width: Math.round(rect.width * scaleFactor),
          height: Math.round(rect.height * scaleFactor)
        });

        // Test render: triangle that extends beyond viewport to test scissor clipping
        // One vertex goes outside NDC bounds to verify clipping works
        const testVertices: number[] = [
          // Position (x, y, z) + Color (r, g, b)
          0.0,  0.8, 0.0,   1.0, 0.0, 0.0,  // 0: top center - red
         -0.8, -0.8, 0.0,   0.0, 1.0, 0.0,  // 1: bottom left - green
          1.5, -0.8, 0.0,   0.0, 0.0, 1.0,  // 2: bottom right - blue (EXTENDS PAST RIGHT EDGE)
        ];
        // CCW winding when viewed from +Z: 0 -> 1 -> 2 (top -> bottom-left -> bottom-right)
        const testIndices: number[] = [0, 1, 2];

        await invoke("render_scene_gpu", {
          sceneVertices: testVertices,
          sceneIndices: testIndices
        });
        console.log("Test triangle rendered");
      } catch (error) {
        console.error("Failed to update GPU viewport:", error);
      }
    }
  });

  // Cleanup GPU renderer on unmount
  onCleanup(async () => {
    if (props.renderMode === "gpu") {
      try {
        await invoke("shutdown_gpu_renderer");
        console.log("GPU renderer shut down");
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
          <canvas
            style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: auto; background: transparent;"
            onMouseDown={(e) => console.log('Canvas mouse down', e)}
            onMouseMove={(e) => console.log('Canvas mouse move', e)}
            onMouseUp={(e) => console.log('Canvas mouse up', e)}
          />
        )}
      </div>
    </div>
  );
};

export default ThreeDViewport;
