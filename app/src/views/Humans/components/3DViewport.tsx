import { createSignal } from "solid-js";
import VoxelMorphScene from "./VoxelMorphScene";
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
      <div class="viewport-content">
        <VoxelMorphScene
          mouldRadius={props.mouldRadius}
          voxelResolution={props.voxelResolution}
          jointMovement={props.jointMovement}
          jointRotation={props.jointRotation}
          showWireframe={showWireframe()}
          showSkeleton={props.showSkeleton}
          selectedJointId={props.selectedJointId}
          onSkeletonReady={props.onSkeletonReady}
          onMouldsReady={props.onMouldsReady}
          onJointSelected={props.onJointSelected}
          onJointClicked={props.onJointClicked}
        />
      </div>
    </div>
  );
};

export default ThreeDViewport;
