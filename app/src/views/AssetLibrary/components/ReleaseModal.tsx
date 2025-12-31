import { createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { createActor } from "xstate";
import Icon from "../../../components/Icon";
import { releaseMachine } from "../machines/releaseMachine";
import type { Asset, Release } from "../types";
import "./ReleaseModal.css";

export type ReleaseModalProps = {
  isOpen: boolean;
  onClose: () => void;
  availableAssets: Asset[];
  onPublishRelease: (releaseData: {
    name: string;
    version: string;
    description: string;
    assetIds: string[];
  }) => Promise<void>;
};

const ReleaseModal = (props: ReleaseModalProps) => {
  let dialogRef: HTMLDialogElement | undefined;

  // State machine actor
  const [actor, setActor] = createSignal(
    createActor(releaseMachine, {
      input: {
        releaseId: crypto.randomUUID(),
        name: "",
        version: "",
        description: "",
        assetIds: [],
      },
    })
  );

  // Local UI state
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isPublishing, setIsPublishing] = createSignal(false);

  // Start the actor
  onMount(() => {
    actor().start();
  });

  // Clean up actor on unmount
  onCleanup(() => {
    actor().stop();
  });

  // Dialog management
  createEffect(() => {
    if (props.isOpen && dialogRef && !dialogRef.open) {
      dialogRef.showModal();
    } else if (!props.isOpen && dialogRef?.open) {
      dialogRef.close();
    }
  });

  const handleCancel = (e: Event) => {
    e.preventDefault();
    props.onClose();
  };

  const handleClose = () => {
    props.onClose();
  };

  // Get current state
  const getCurrentState = () => actor().getSnapshot();

  // Asset selection handlers
  const handleToggleAsset = (assetId: string) => {
    const context = getCurrentState().context;
    if (context.assetIds.includes(assetId)) {
      actor().send({ type: "REMOVE_ASSET", assetId });
    } else {
      actor().send({ type: "ADD_ASSET", assetId });
    }
  };

  const handleSelectAll = () => {
    const filtered = getFilteredAssets();
    filtered.forEach((asset) => {
      if (!getCurrentState().context.assetIds.includes(asset.id)) {
        actor().send({ type: "ADD_ASSET", assetId: asset.id });
      }
    });
  };

  const handleDeselectAll = () => {
    const filtered = getFilteredAssets();
    filtered.forEach((asset) => {
      if (getCurrentState().context.assetIds.includes(asset.id)) {
        actor().send({ type: "REMOVE_ASSET", assetId: asset.id });
      }
    });
  };

  // Metadata handlers
  const handleUpdateMetadata = (field: "name" | "version" | "description", value: string) => {
    actor().send({
      type: "UPDATE_METADATA",
      [field]: value,
    });
  };

  // Publish handler
  const handlePublish = async () => {
    const context = getCurrentState().context;

    if (!context.name || !context.version || context.assetIds.length === 0) {
      return;
    }

    setIsPublishing(true);
    actor().send({ type: "PUBLISH" });

    try {
      await props.onPublishRelease({
        name: context.name,
        version: context.version,
        description: context.description || "",
        assetIds: context.assetIds,
      });

      actor().send({
        type: "PUBLISH_SUCCESS",
        publishedAt: new Date().toISOString(),
        publishedBy: "current-user", // TODO: Get from app settings
      });

      // Close modal after successful publish
      setTimeout(() => {
        props.onClose();
      }, 500);
    } catch (error) {
      actor().send({
        type: "PUBLISH_FAILURE",
        error: error instanceof Error ? error.message : "Failed to publish release",
      });
    } finally {
      setIsPublishing(false);
    }
  };

  // Filter assets
  const getFilteredAssets = () => {
    const query = searchQuery().toLowerCase();
    if (!query) return props.availableAssets;

    return props.availableAssets.filter(
      (asset) =>
        asset.name.toLowerCase().includes(query) ||
        asset.type.toLowerCase().includes(query) ||
        asset.category.toLowerCase().includes(query)
    );
  };

  const isAssetSelected = (assetId: string) => {
    return getCurrentState().context.assetIds.includes(assetId);
  };

  const canPublish = () => {
    const context = getCurrentState().context;
    return context.name && context.version && context.assetIds.length > 0;
  };

  const getSelectedCount = () => {
    return getCurrentState().context.assetIds.length;
  };

  return (
    <Show when={props.isOpen}>
      <dialog ref={dialogRef} class="release-modal" onCancel={handleCancel}>
        <div class="release-modal-content">
          <div class="release-modal-header">
            <div class="header-title">
              <Icon name="upload" size={24} />
              <h2>Create New Release</h2>
            </div>
            <button class="close-btn" onClick={handleClose} type="button" aria-label="Close">
              <Icon name="close" size={20} />
            </button>
          </div>

          <div class="release-modal-body">
            {/* Metadata Section */}
            <div class="metadata-section">
              <h3>Release Information</h3>
              <div class="form-group">
                <label for="release-name">Release Name *</label>
                <input
                  id="release-name"
                  type="text"
                  placeholder="e.g., Winter Collection 2025"
                  value={getCurrentState().context.name}
                  onInput={(e) => handleUpdateMetadata("name", e.currentTarget.value)}
                  class="text-input"
                />
              </div>

              <div class="form-group">
                <label for="release-version">Version *</label>
                <input
                  id="release-version"
                  type="text"
                  placeholder="e.g., 1.0.0"
                  value={getCurrentState().context.version}
                  onInput={(e) => handleUpdateMetadata("version", e.currentTarget.value)}
                  class="text-input"
                />
              </div>

              <div class="form-group">
                <label for="release-description">Description</label>
                <textarea
                  id="release-description"
                  placeholder="Describe what's new in this release..."
                  value={getCurrentState().context.description || ""}
                  onInput={(e) => handleUpdateMetadata("description", e.currentTarget.value)}
                  class="text-area"
                  rows={3}
                />
              </div>
            </div>

            {/* Asset Selection Section */}
            <div class="asset-selection-section">
              <div class="section-header">
                <h3>Select Assets ({getSelectedCount()} selected)</h3>
                <div class="bulk-actions">
                  <button class="text-btn" onClick={handleSelectAll} type="button">
                    Select All
                  </button>
                  <button class="text-btn" onClick={handleDeselectAll} type="button">
                    Deselect All
                  </button>
                </div>
              </div>

              <div class="asset-search">
                <Icon name="search" size={16} />
                <input
                  type="text"
                  placeholder="Search assets..."
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  class="search-input"
                />
              </div>

              <div class="asset-list">
                <For each={getFilteredAssets()}>
                  {(asset) => (
                    <div
                      class={`asset-item ${isAssetSelected(asset.id) ? "selected" : ""}`}
                      onClick={() => handleToggleAsset(asset.id)}
                    >
                      <div class="asset-checkbox">
                        <input
                          type="checkbox"
                          checked={isAssetSelected(asset.id)}
                          onChange={() => handleToggleAsset(asset.id)}
                        />
                      </div>
                      <div class="asset-info">
                        <div class="asset-name">{asset.name}</div>
                        <div class="asset-meta">
                          {asset.type} • {asset.category} • v{asset.version}
                        </div>
                      </div>
                    </div>
                  )}
                </For>

                <Show when={getFilteredAssets().length === 0}>
                  <div class="empty-state">
                    <Icon name="search" size={48} />
                    <p>No assets found</p>
                  </div>
                </Show>
              </div>
            </div>

            {/* Error Display */}
            <Show when={getCurrentState().context.error}>
              <div class="error-message">
                <Icon name="x-circle" size={16} />
                {getCurrentState().context.error}
              </div>
            </Show>
          </div>

          <div class="release-modal-footer">
            <button class="btn btn-secondary" onClick={handleClose} type="button">
              Cancel
            </button>
            <button
              class="btn btn-primary"
              onClick={handlePublish}
              disabled={!canPublish() || isPublishing()}
              type="button"
            >
              <Icon name="upload" size={16} />
              {isPublishing() ? "Publishing..." : "Publish Release"}
            </button>
          </div>
        </div>
      </dialog>
    </Show>
  );
};

export default ReleaseModal;
