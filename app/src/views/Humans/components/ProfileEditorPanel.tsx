// ProfileEditorPanel: Sidebar section for editing radial profiles of a profiled-capsule mould.
// Shows ring navigation, ghost toggle, the 2D RingEditor, and handle count controls.

import { Show } from "solid-js";
import type { Mould } from "../morphing/types";
import RingEditor from "./RingEditor";

type ProfileEditorPanelProps = {
  mouldId: string;
  mould: Mould;
  profiles: number[][];        // reactive copy owned by parent
  activeRingIndex: number;
  showGhostAbove: boolean;
  onRingChange: (idx: number) => void;
  onGhostToggle: (above: boolean) => void;
  onAddRing: (afterIdx: number) => void;
  onRemoveRing: (idx: number) => void;
  onHandleChange: (segIdx: number, ptIdx: number, radius: number) => void;
  onAddHandle: (segIdx: number, afterPtIdx: number) => void;
  onRemoveHandle: (segIdx: number, ptIdx: number) => void;
};

const ProfileEditorPanel = (props: ProfileEditorPanelProps) => {
  const ringCount = () => props.profiles.length;
  const activeRing = () => props.profiles[props.activeRingIndex] ?? [];

  const ghostRing = () => {
    if (props.showGhostAbove) {
      return props.profiles[props.activeRingIndex + 1] ?? null;
    }
    return props.profiles[props.activeRingIndex - 1] ?? null;
  };

  const canRemoveRing = () => ringCount() > 1;
  const canRemoveHandle = () => activeRing().length > 3;

  return (
    <div class="property-section">
      <h4>Profile: {props.mouldId}</h4>

      {/* Ring navigation row */}
      <div class="profile-ring-nav">
        <button
          class="profile-nav-btn"
          disabled={props.activeRingIndex === 0}
          onClick={() => props.onRingChange(props.activeRingIndex - 1)}
        >
          ◀
        </button>
        <span class="profile-ring-label">Ring {props.activeRingIndex + 1} / {ringCount()}</span>
        <button
          class="profile-nav-btn"
          disabled={props.activeRingIndex >= ringCount() - 1}
          onClick={() => props.onRingChange(props.activeRingIndex + 1)}
        >
          ▶
        </button>
        <button
          class="profile-action-btn"
          title="Add ring after current"
          onClick={() => props.onAddRing(props.activeRingIndex)}
        >
          + Ring
        </button>
        <button
          class="profile-action-btn profile-action-btn--danger"
          title="Remove current ring"
          disabled={!canRemoveRing()}
          onClick={() => props.onRemoveRing(props.activeRingIndex)}
        >
          − Ring
        </button>
      </div>

      {/* Ghost toggle */}
      <div class="profile-ghost-row">
        <span class="profile-ghost-label">Ghost:</span>
        <button
          class={`profile-ghost-btn ${!props.showGhostAbove ? "active" : ""}`}
          disabled={props.activeRingIndex === 0}
          onClick={() => props.onGhostToggle(false)}
          title="Show ring below as ghost"
        >
          ▼ Below
        </button>
        <button
          class={`profile-ghost-btn ${props.showGhostAbove ? "active" : ""}`}
          disabled={props.activeRingIndex >= ringCount() - 1}
          onClick={() => props.onGhostToggle(true)}
          title="Show ring above as ghost"
        >
          ▲ Above
        </button>
      </div>

      {/* 2D ring editor */}
      <div class="profile-editor-canvas">
        <Show when={activeRing().length > 0}>
          <RingEditor
            activeRing={activeRing()}
            ghostRing={ghostRing()}
            onHandleChange={(ptIdx, radius) => props.onHandleChange(props.activeRingIndex, ptIdx, radius)}
            onAddHandle={(afterPtIdx) => props.onAddHandle(props.activeRingIndex, afterPtIdx)}
            onRemoveHandle={(ptIdx) => props.onRemoveHandle(props.activeRingIndex, ptIdx)}
          />
        </Show>
      </div>

      {/* Handle count row */}
      <div class="profile-handle-row">
        <span class="profile-handle-label">Handles: {activeRing().length}</span>
        <button
          class="profile-action-btn"
          title="Add handle (or double-click ring path)"
          onClick={() => {
            const n = activeRing().length;
            props.onAddHandle(props.activeRingIndex, Math.floor(n / 2));
          }}
        >
          + Handle
        </button>
        <button
          class="profile-action-btn profile-action-btn--danger"
          title="Remove last handle (min 3)"
          disabled={!canRemoveHandle()}
          onClick={() => props.onRemoveHandle(props.activeRingIndex, activeRing().length - 1)}
        >
          − Handle
        </button>
      </div>
    </div>
  );
};

export default ProfileEditorPanel;
