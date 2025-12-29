import { Accessor, For } from "solid-js";
import type { Asset } from "../../types/asset";

interface AssetCardProps {
  asset: Asset;
  onClick: (asset: Asset) => void;
  convertToAssetPath: (url: string, cacheBust: boolean) => string;
  thumbnailHasCacheBust: boolean;
  cachedAssets: Accessor<Set<string>>;
  downloading: Accessor<string | null>;
  onDownload: (id: string, name: string) => void;
  editedAssets?: Accessor<Map<string, any>>;
  allAssets?: Accessor<Asset[]>;
  onAssetClick?: (asset: Asset) => void;
}

const AssetCard = (props: AssetCardProps) => {
  const isEdited = () => props.asset.id.includes("_edited_");
  const isPending = () => isEdited() && props.editedAssets?.().get(props.asset.id)?.metadata.submission_status === "pending";

  const getOriginalAsset = () => {
    if (!isEdited()) return null;
    const originalId = props.asset.id.split("_edited_")[0];
    return props.allAssets?.()?.find((a: Asset) => a.id === originalId);
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </div>

        {/* Badges */}
        {props.asset.required && (
          <span class="required-badge overlay-badge">Essential</span>
        )}
        {isPending() && (
          <span class="pending-badge overlay-badge">Pending Review</span>
        )}
        {isEdited() && (() => {
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
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <circle cx="18" cy="6" r="3" />
                <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
                <path d="M12 12v3" />
              </svg>
              Unpublished
            </span>
          );
        })()}
      </div>

      <div class="asset-info">
        <div class="asset-header">
          <div class="asset-title-row">
            <h3 class="asset-name">{props.asset.name}</h3>
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
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
            </button>
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
                <svg
                  class={`star ${star <= props.asset.rating ? "filled" : ""}`}
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill={star <= props.asset.rating ? "currentColor" : "none"}
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
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
