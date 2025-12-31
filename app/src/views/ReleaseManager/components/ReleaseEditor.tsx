/**
 * ReleaseEditor Component
 * Allows creating and editing release metadata and asset selection
 */

import { createSignal, For, Show } from "solid-js";
import { createActor } from "xstate";
import Icon from "../../../components/Icon";
import { releaseMachine } from "../../AssetLibrary/machines/releaseMachine";
import { canPublishRelease, isReleaseMetadataValid } from "../utils";
import type { ReleaseEditorProps } from "../types";

const ReleaseEditor = (props: ReleaseEditorProps) => {
  const actor = createActor(releaseMachine, {
    input: {
      releaseId: props.releaseId || crypto.randomUUID(),
      name: "",
      version: "",
      description: "",
      assetIds: [],
    },
  }).start();

  const [isSaving, setIsSaving] = createSignal(false);
  const [isPublishing, setIsPublishing] = createSignal(false);

  const handleToggleAsset = (assetId: string) => {
    const snapshot = actor.getSnapshot();
    if (snapshot.context.assetIds.includes(assetId)) {
      actor.send({ type: "REMOVE_ASSET", assetId });
    } else {
      actor.send({ type: "ADD_ASSET", assetId });
    }
  };

  const handleSaveDraft = async () => {
    const context = actor.getSnapshot().context;
    setIsSaving(true);
    try {
      await props.onSave({
        name: context.name,
        version: context.version,
        description: context.description || "",
        assetIds: context.assetIds,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!props.releaseId) return;
    setIsPublishing(true);
    try {
      await props.onPublish(props.releaseId);
    } finally {
      setIsPublishing(false);
    }
  };

  const canSave = () => {
    const context = actor.getSnapshot().context;
    return isReleaseMetadataValid(context.name, context.version);
  };

  const canPublish = () => {
    const context = actor.getSnapshot().context;
    return canPublishRelease(context.name, context.version, context.assetIds);
  };

  return (
    <div class="release-editor">
      <div class="editor-header">
        <h2>{props.isNew ? "Create New Release" : "Edit Release"}</h2>
        <div class="editor-actions">
          <button class="btn btn-secondary" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            class="btn btn-secondary"
            onClick={handleSaveDraft}
            disabled={!canSave() || isSaving()}
          >
            <Icon name="save" size={16} />
            {isSaving() ? "Saving..." : "Save Draft"}
          </button>
          <Show when={!props.isNew}>
            <button
              class="btn btn-primary"
              onClick={handlePublish}
              disabled={!canPublish() || isPublishing()}
            >
              <Icon name="rocket" size={16} />
              {isPublishing() ? "Publishing..." : "Publish Release"}
            </button>
          </Show>
        </div>
      </div>

      <div class="editor-content">
        {/* Metadata form */}
        <div class="metadata-section">
          <h3>Release Information</h3>
          <div class="form-row">
            <div class="form-group">
              <label>Name *</label>
              <input
                type="text"
                placeholder="e.g., Winter Collection 2025"
                value={actor.getSnapshot().context.name}
                onInput={(e) =>
                  actor.send({
                    type: "UPDATE_METADATA",
                    name: e.currentTarget.value,
                  })
                }
              />
            </div>
            <div class="form-group">
              <label>Version *</label>
              <input
                type="text"
                placeholder="e.g., 1.0.0"
                value={actor.getSnapshot().context.version}
                onInput={(e) =>
                  actor.send({
                    type: "UPDATE_METADATA",
                    version: e.currentTarget.value,
                  })
                }
              />
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea
              placeholder="Describe what's new in this release..."
              value={actor.getSnapshot().context.description || ""}
              onInput={(e) =>
                actor.send({
                  type: "UPDATE_METADATA",
                  description: e.currentTarget.value,
                })
              }
              rows={3}
            />
          </div>
        </div>

        {/* Asset selection */}
        <div class="assets-section">
          <div class="section-header">
            <h3>Assets ({actor.getSnapshot().context.assetIds.length} selected)</h3>
            <div class="search-box">
              <Icon name="search" size={16} />
              <input
                type="text"
                placeholder="Search assets..."
                value={props.searchQuery}
                onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
              />
            </div>
          </div>

          <div class="assets-grid">
            <For each={props.availableAssets}>
              {(asset) => (
                <div
                  class={`asset-card ${
                    actor.getSnapshot().context.assetIds.includes(asset.id) ? "selected" : ""
                  }`}
                  onClick={() => handleToggleAsset(asset.id)}
                >
                  <div class="asset-checkbox">
                    <input
                      type="checkbox"
                      checked={actor.getSnapshot().context.assetIds.includes(asset.id)}
                      onChange={() => handleToggleAsset(asset.id)}
                    />
                  </div>
                  <div class="asset-details">
                    <div class="asset-name">{asset.name}</div>
                    <div class="asset-meta">
                      {asset.type} • {asset.category}
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReleaseEditor;
