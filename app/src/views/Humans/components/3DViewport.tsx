import VoxelMorphScene from "./VoxelMorphScene";
import Icon from "../../../components/Icon";

type ThreeDViewportProps = {
  onAddHuman: () => void;
  mouldRadius: number;
}

const ThreeDViewport = (props: ThreeDViewportProps) => {
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
          <button class="tool-btn">◎</button>
          <button class="tool-btn">↻</button>
          <button class="tool-btn">⊞</button>
        </div>
      </div>
      <div class="viewport-content">
        <VoxelMorphScene mouldRadius={props.mouldRadius} />
      </div>
    </div>
  );
};

export default ThreeDViewport;
