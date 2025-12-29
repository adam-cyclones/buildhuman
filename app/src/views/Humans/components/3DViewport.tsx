import type { Scene } from "@babylonjs/core";
import BabylonScene from "./BabylonScene";
import Icon from "../../../components/Icon";

interface ThreeDViewportProps {
  onSceneReady: (scene: Scene) => void;
  onAddHuman: () => void;
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
        <BabylonScene onSceneReady={props.onSceneReady} />
      </div>
    </div>
  );
};

export default ThreeDViewport;
