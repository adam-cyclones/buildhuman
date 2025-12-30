import { For } from "solid-js";
import type { Asset, AssetCardProps } from "../types";
import Icon from "../../../components/Icon";
import { getPublishingActor } from "../machines/assetPublishingService";
import { getEditingActor } from "../machines/assetEditingService";

const AssetCard = (props: AssetCardProps) => {
  const isEdited = () => props.asset.id.includes("_edited_");
  const isPending = () => isEdited() && props.asset.submission_status === "pending";

  const getOriginalAsset = () => {
    if (!isEdited()) return null;
    const originalId = props.asset.id.split("_edited_")[0];
    return props.allAssets?.()?.find((a: Asset) => a.id === originalId);
  };

  const canPublish = () => {
    if (!isEdited()) return false;

    const editedAsset = props.editedAssets?.().get(props.asset.id);
    if (!editedAsset || !editedAsset.file_path) return false; // No file saved yet

    const pubSnapshot = getPublishingActor(props.asset.id, editedAsset.metadata).getSnapshot();
    const editSnapshot = getEditingActor(props.asset.id).getSnapshot();

    // Can publish if in editing state and no unsaved changes, OR if pending with edits
    const isPendingState = pubSnapshot.matches("pending");
    const hasEditedAfterSubmit = pubSnapshot.context.editedAfterSubmit;
    const hasUnsaved = editSnapshot.context.hasUnsavedChanges;

    return (!isPendingState && !hasUnsaved) || (isPendingState && hasEditedAfterSubmit && !hasUnsaved);
  };


  return (
    <div class="asset-card" onClick={() => props.onClick(props.asset)}>
      <div class="asset-thumbnail">
        {props.asset.thumbnail_url ? (
          <img
            src={props.convertToAssetPath(props.asset.thumbnail_url, props.thumbnailHasCacheBust)}
            alt={props.asset.name}
            class="asset-thumbnail-image"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
        <div class={`placeholder-icon ${props.asset.thumbnail_url ? 'hidden' : ''}`}>
          <Icon name="image" size={48} />
        </div>

        {/* Badges - Pending Review takes precedence over Editing */}
        {props.asset.required && (
          <span class="required-badge overlay-badge">Essential</span>
        )}
        {isPending() ? (
          <span class="pending-badge overlay-badge">Pending Review</span>
        ) : isEdited() ? (() => {
          const originalAsset = getOriginalAsset();
          return (
            <span
              class="unpublished-badge overlay-badge"
              title={`Based on "${originalAsset?.name || "original"}" - click to view original`}
              onClick={(e) => {
                e.stopPropagation();
                if (originalAsset && props.onAssetClick) {
                  props.onAssetClick(originalAsset);
                }
              }}
            >
              <Icon name="fork" size={12} />
              Editing
            </span>
          );
        })() : null}
      </div>

      <div class="asset-info">
        <div class="asset-header">
          <div class="asset-title-row">
            <h3 class="asset-name">{props.asset.name}</h3>
            {!isEdited() && (
              // Library assets only: show download button
              <button
                class={`download-icon-btn ${props.cachedAssets().has(props.asset.id) ? "cached" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDownload(props.asset.id, props.asset.name);
                }}
                disabled={props.downloading() === props.asset.id || props.cachedAssets().has(props.asset.id)}
                title={props.cachedAssets().has(props.asset.id) ? "Downloaded" : "Download"}
              >
                {props.downloading() === props.asset.id ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="spinner">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" opacity="0.4" />
                    <path d="M12 2v4" opacity="1" />
                  </svg>
                ) : props.cachedAssets().has(props.asset.id) ? (
                  <Icon name="check" size={20} />
                ) : (
                  <Icon name="download" size={20} />
                )}
              </button>
            )}
            {isEdited() && canPublish() && props.onPublishAsset && (
              // Edited assets: show publish button (when ready)
              <button
                class="publish-icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onPublishAsset!(props.asset.id);
                }}
                title="Publish asset"
              >
                <Icon name="upload" size={20} />
              </button>
            )}
          </div>
        </div>
        {props.asset.description && (
          <p class="asset-description">{props.asset.description}</p>
        )}
        <div class="asset-meta">
          <span class="asset-type">{props.asset.type}</span>
          <span class="asset-author">{props.asset.author}</span>
        </div>
        {!isEdited() && (
          <div class="asset-rating">
            <For each={[1, 2, 3, 4, 5]}>
              {(star) => (
                <Icon
                  name="star"
                  size={12}
                  class={`star ${star <= props.asset.rating ? "filled" : ""}`}
                  style={{ fill: star <= props.asset.rating ? "currentColor" : "none" }}
                />
              )}
            </For>
            {props.asset.rating_count > 0 && (
              <span class="rating-count">({props.asset.rating_count})</span>
            )}
            <span class="asset-downloads">↓ {props.asset.downloads}</span>
          </div>
        )}
        <div class="asset-stats">
          <span class="asset-license">{props.asset.license}</span>
        </div>
      </div>
    </div>
  );
};

export default AssetCard;
