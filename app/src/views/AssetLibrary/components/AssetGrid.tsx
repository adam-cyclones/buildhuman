import { For } from "solid-js";
import type { AssetGridProps } from "../types";
import AssetCard from "./AssetCard";

const AssetGrid = (props: AssetGridProps) => {
  return (
    <div class={`asset-grid ${props.viewMode() === "list" ? "list-view" : ""}`}>
      {props.loading && <div class="loading">Loading assets...</div>}

      {props.error && (
        <div class="error">
          Failed to load assets. Make sure the asset service is running at {props.apiUrl}
        </div>
      )}

      {props.assets().length === 0 && !props.loading && props.selectedType() === "pending" && (
        <div class="empty">
          <h3>No Pending Submissions</h3>
          <p>Submitted assets will appear here for review.</p>
          <p style="margin-top: 1rem; font-size: 0.9rem; opacity: 0.7;">
            To test: Edit an asset and click "Publish Asset" to create a submission.
          </p>
        </div>
      )}

      {props.assets().length === 0 && !props.loading && props.selectedType() !== "pending" && (
        <div class="empty">No assets found. Try running: poetry poe seed</div>
      )}

      <For each={props.assets()}>
        {(asset) => (
          <AssetCard
            asset={asset}
            onClick={props.onAssetClick}
            convertToAssetPath={props.convertToAssetPath}
            thumbnailHasCacheBust={props.thumbnailTimestamps().has(asset.id)}
            cachedAssets={props.cachedAssets}
            downloading={props.downloading}
            onDownload={props.onDownload}
            editedAssets={props.editedAssets}
            allAssets={props.allAssets}
            onAssetClick={props.onAssetClick}
            onPublishAsset={props.onPublishAsset}
            isSelectable={props.selectedType() === "pending"}
            isSelected={props.selectedSubmissions?.().has(asset.id)}
            onToggleSelect={props.onToggleSubmissionSelect}
          />
        )}
      </For>
    </div>
  );
};

export default AssetGrid;
