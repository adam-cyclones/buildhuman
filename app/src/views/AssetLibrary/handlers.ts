/**
 * Event handlers for AssetLibrary
 * All user interaction handlers
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { config } from "../../config";
import { publishAssetToService, submitReview } from "./client";
import { hasMetadataChanges } from "./utils";
import type { Asset, LocalAsset, Download, AssetMachines } from "./types";
import type { AssetLibraryState } from "./hooks/useAssetState";

const API_URL = config.apiUrl;

export interface HandlerDependencies extends AssetLibraryState {
  fetchCachedAssets: () => Promise<void>;
  showMetadataSaveToast: (message: string, duration?: number) => void;
  logEvent: (assetId: string, eventType: string, metadata?: any) => Promise<void>;
  getMachine: (assetId: string, metadata?: any) => AssetMachines;
  fetchPendingSubmissions: () => Promise<void>;
  appSettings?: { moderator_api_key?: string; moderator_mode?: boolean } | null;
}

/**
 * Handle asset download
 */
export const createDownloadHandler = (deps: HandlerDependencies) => {
  return async (assetId: string, assetName: string) => {
    // Add to download queue
    const download: Download = {
      id: assetId,
      name: assetName,
      status: "downloading",
      timestamp: Date.now(),
    };
    deps.setDownloadQueue([download, ...deps.downloadQueue()]);
    deps.setIsDownloadsPanelOpen(true);

    try {
      deps.setDownloading(assetId);

      // Start download and minimum display time in parallel
      const startTime = Date.now();
      const minDisplayTime = 800;

      const result = await invoke("download_asset", {
        assetId,
        apiUrl: API_URL,
      });

      // Ensure spinner shows for at least minDisplayTime
      const elapsed = Date.now() - startTime;
      if (elapsed < minDisplayTime) {
        await new Promise(resolve => setTimeout(resolve, minDisplayTime - elapsed));
      }

      console.log("Downloaded:", result);

      // Update download status to completed
      deps.setDownloadQueue(
        deps.downloadQueue().map((d) =>
          d.id === assetId ? { ...d, status: "completed" as const } : d
        )
      );

      // Update cached assets list
      await deps.fetchCachedAssets();
    } catch (error) {
      console.error("Download failed:", error);

      // Update download status to failed
      deps.setDownloadQueue(
        deps.downloadQueue().map((d) =>
          d.id === assetId
            ? { ...d, status: "failed" as const, error: String(error) }
            : d
        )
      );
    } finally {
      deps.setDownloading(null);
    }
  };
};

/**
 * Handle asset click (open detail panel)
 */
export const createAssetClickHandler = (deps: Pick<AssetLibraryState, "setSelectedAsset" | "setIsPanelOpen">) => {
  return (asset: Asset) => {
    deps.setSelectedAsset(asset);
    deps.setIsPanelOpen(true);
  };
};

/**
 * Handle close panel
 */
export const createClosePanelHandler = (deps: Pick<AssetLibraryState, "setIsPanelOpen">) => {
  return () => {
    deps.setIsPanelOpen(false);
  };
};

/**
 * Handle delete cached asset
 */
export const createDeleteCachedAssetHandler = (deps: HandlerDependencies) => {
  return async (assetId: string, assetName: string) => {
    if (!confirm(`Delete "${assetName}" from cache?`)) {
      return;
    }

    try {
      await invoke("delete_cached_asset", { assetId });
      await deps.fetchCachedAssets();
      deps.setIsPanelOpen(false);
    } catch (error) {
      console.error("Failed to delete asset:", error);
      alert(`Failed to delete: ${error}`);
    }
  };
};

/**
 * Handle edit asset (enter editing mode)
 */
export const createEditAssetHandler = (deps: HandlerDependencies) => {
  return async (assetId: string) => {
    const asset = deps.selectedAsset();
    if (!asset) return;

    // Check if there's already a saved edited version
    const existingEdited = deps.editedAssets().get(assetId + "_editing");

    // Create a temporary edited asset (no files created yet)
    const editedAsset: Asset = existingEdited
      ? {
          ...(existingEdited.metadata as Asset),
          id: assetId + "_editing",
        }
      : {
          ...asset,
          id: assetId + "_editing",
        };

    deps.setSelectedAsset(editedAsset);

    // Store the original for later copy creation (only if not already stored)
    if (!existingEdited) {
      deps.setOriginalEditedMetadata(prev => {
        const newMap = new Map(prev);
        newMap.set(editedAsset.id, { ...asset });
        return newMap;
      });
    }
  };
};

/**
 * Handle revert to original
 */
export const createRevertToOriginalHandler = (deps: HandlerDependencies) => {
  return async (editedId: string) => {
    // Check if we actually created files or just in "_editing" mode
    const hasRealCopy = deps.editedAssets().has(editedId);

    if (hasRealCopy) {
      // Files were created - need to delete them
      if (hasMetadataChanges(editedId, deps.originalEditedMetadata(), deps.selectedAsset())) {
        if (!confirm("Revert to original? This will discard your changes and delete the edited files.")) {
          return;
        }
      }

      try {
        await invoke("revert_to_original", { editedId });

        // Remove from edited assets map
        deps.setEditedAssets(prev => {
          const newMap = new Map(prev);
          newMap.delete(editedId);
          return newMap;
        });

        // Remove from original metadata map
        deps.setOriginalEditedMetadata(prev => {
          const newMap = new Map(prev);
          newMap.delete(editedId);
          return newMap;
        });

        deps.setIsPanelOpen(false);
      } catch (error) {
        console.error("Failed to revert to original:", error);
        alert(`Failed to revert: ${error}`);
      }
    } else {
      // Just in "_editing" mode - no files created, just close
      console.log("Canceling edit mode - no files to delete");

      // Remove from original metadata map
      deps.setOriginalEditedMetadata(prev => {
        const newMap = new Map(prev);
        newMap.delete(editedId);
        return newMap;
      });

      deps.setIsPanelOpen(false);
    }
  };
};

/**
 * Handle open in Blender
 */
export const createOpenInBlenderHandler = (deps: HandlerDependencies) => {
  return async (assetId: string) => {
    try {
      // Create editable copy if it doesn't exist yet
      let editedAsset = deps.editedAssets().get(assetId);

      if (!editedAsset) {
        // Extract original asset ID (remove "_editing" suffix if present)
        const originalId = assetId.replace("_editing", "");

        console.log("Creating editable copy for:", originalId);
        const newCopy = await invoke<LocalAsset>("create_editable_copy", { assetId: originalId });

        // Add to edited assets map
        deps.setEditedAssets(prev => {
          const newMap = new Map(prev);
          newMap.set(newCopy.metadata.id, newCopy);
          return newMap;
        });

        // Update selected asset to use the real edited ID
        const asset = deps.selectedAsset();
        if (asset) {
          const realEditedAsset: Asset = {
            ...asset,
            id: newCopy.metadata.id,
            name: newCopy.metadata.name,
            author: newCopy.metadata.author,
          };
          deps.setSelectedAsset(realEditedAsset);
        }

        editedAsset = newCopy;

        // Log fork event
        await deps.logEvent(newCopy.metadata.id, "forked", {
          original_id: originalId,
          original_name: asset?.name || "original asset"
        });
      }

      if (editedAsset) {
        await invoke("open_in_blender", {
          filePath: editedAsset.file_path,
          assetId: editedAsset.metadata.id,
        });

        deps.showMetadataSaveToast(`✨ Opening in Blender... Auto-export enabled! Just press Ctrl+S to save.`, 5000);
      }
    } catch (error) {
      console.error("Failed to open in Blender:", error);
      alert(`Failed to open in Blender: ${error}`);
    }
  };
};

/**
 * Handle save metadata
 */
export const createSaveMetadataHandler = (deps: HandlerDependencies) => {
  return async (assetId: string) => {
    // Get or create machine for this asset
    let machines = deps.getMachine(assetId);

    // Send SAVE event to editing machine
    machines.editing.send({ type: "SAVE" });

    try {
      const updatedAsset = deps.selectedAsset();
      if (!updatedAsset) return;

      // Create editable copy if it doesn't exist yet
      let editedAsset = deps.editedAssets().get(assetId);

      if (!editedAsset) {
        // Extract original asset ID (remove "_editing" suffix if present)
        const originalId = assetId.replace("_editing", "");

        console.log("Creating editable copy for save:", originalId);
        const newCopy = await invoke<LocalAsset>("create_editable_copy", { assetId: originalId });

        // Add to edited assets map
        deps.setEditedAssets(prev => {
          const newMap = new Map(prev);
          newMap.set(newCopy.metadata.id, newCopy);
          return newMap;
        });

        // Update selected asset to use the real edited ID
        const realEditedAsset: Asset = {
          ...updatedAsset,
          id: newCopy.metadata.id,
        };
        deps.setSelectedAsset(realEditedAsset);

        editedAsset = newCopy;
        assetId = newCopy.metadata.id;

        // Get new machine for the real asset ID
        machines = deps.getMachine(assetId, editedAsset.metadata);
      }

      // Convert Asset to AssetMetadata format for backend
      const metadata: any = {
        id: assetId,
        name: updatedAsset.name,
        type: updatedAsset.type,
        category: updatedAsset.category,
        author: updatedAsset.author,
        description: updatedAsset.description || "",
        license: updatedAsset.license,
        version: updatedAsset.version,
        file_size: updatedAsset.file_size,
        required: updatedAsset.required,
        rating: updatedAsset.rating,
        rating_count: updatedAsset.rating_count,
        downloads: updatedAsset.downloads,
        publish_date: updatedAsset.publish_date,
        thumbnail_url: updatedAsset.thumbnail_url,
      };

      // Check publishing machine state
      const isPending = machines.publishing.isPending();
      if (isPending) {
        machines.publishing.send({ type: "EDIT" });
        metadata.last_edited_after_publish = true;

        deps.setEditedAssets(prev => {
          const newMap = new Map(prev);
          const asset = newMap.get(assetId);
          if (asset) {
            asset.metadata.last_edited_after_publish = true;
          }
          return newMap;
        });
      }

      await invoke("update_asset_metadata", { assetId, metadata });

      // Send SAVE_SUCCESS to editing machine
      machines.editing.send({ type: "SAVE_SUCCESS" });

      // Log event
      await deps.logEvent(assetId, isPending ? "edited_after_publish" : "metadata_saved", {
        fields: Object.keys(metadata).filter(k => k !== 'id')
      });

      // Update the original metadata to reflect saved state
      deps.setOriginalEditedMetadata(new Map(deps.originalEditedMetadata().set(assetId, { ...updatedAsset })));
    } catch (error) {
      console.error("Failed to save metadata:", error);

      // Send SAVE_FAILURE to editing machine
      machines.editing.send({ type: "SAVE_FAILURE", error: String(error) });

      throw error;
    }
  };
};

/**
 * Handle change thumbnail
 */
export const createChangeThumbnailHandler = (deps: HandlerDependencies) => {
  return async (assetId: string) => {
    try {
      const selected = await open({
        title: "Select Thumbnail Image",
        multiple: false,
        directory: false,
        filters: [{
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "webp"]
        }]
      });

      if (selected) {
        await invoke("set_asset_thumbnail", {
          assetId,
          thumbnailPath: selected
        });

        const thumbnailFilename = await invoke<string>("get_asset_thumbnail", { assetId });

        // Update the selected asset
        const updatedAsset = { ...deps.selectedAsset()! };
        updatedAsset.thumbnail_url = thumbnailFilename;
        deps.setSelectedAsset(updatedAsset);

        // Update the editedAssets map
        if (deps.editedAssets().has(assetId)) {
          deps.setEditedAssets(prev => {
            const newMap = new Map(prev);
            const asset = newMap.get(assetId);
            if (asset) {
              const updatedLocalAsset = {
                ...asset,
                metadata: {
                  ...asset.metadata,
                  thumbnail_url: thumbnailFilename
                }
              };
              newMap.set(assetId, updatedLocalAsset);
            }
            return newMap;
          });
        }

        // Track thumbnail update timestamp for cache-busting
        deps.setThumbnailTimestamps(prev => {
          const newMap = new Map(prev);
          newMap.set(assetId, Date.now());
          localStorage.setItem("thumbnailTimestamps", JSON.stringify(Object.fromEntries(newMap)));
          return newMap;
        });

        deps.showMetadataSaveToast("Thumbnail updated", 2000);

        // Log thumbnail change event
        await deps.logEvent(assetId, "thumbnail_changed", {
          filename: thumbnailFilename
        });
      }
    } catch (error) {
      console.error("Failed to set thumbnail:", error);
      deps.showMetadataSaveToast(`Failed to set thumbnail: ${error}`, 3000);
    }
  };
};

/**
 * Handle publish asset
 */
export const createPublishAssetHandler = (deps: HandlerDependencies) => {
  return async (assetId: string) => {
    const asset = deps.editedAssets().get(assetId);
    if (!asset) {
      alert("Asset not found");
      return;
    }

    const machines = deps.getMachine(assetId, asset.metadata);
    machines.publishing.send({ type: "SUBMIT" });

    try {
      const formData = new FormData();

      // Read the GLB file
      const glbBytes = await readFile(asset.file_path);
      const glbBlob = new Blob([glbBytes], { type: "model/gltf-binary" });
      formData.append("file", glbBlob, `${asset.metadata.name}.glb`);

      // Read thumbnail if exists
      if (asset.metadata.thumbnail_url) {
        const thumbnailPath = `${deps.appDataPath()}/created-assets/${asset.metadata.thumbnail_url}`;
        const thumbnailBytes = await readFile(thumbnailPath);
        const thumbnailBlob = new Blob([thumbnailBytes], { type: "image/png" });
        formData.append("thumbnail", thumbnailBlob, asset.metadata.thumbnail_url);
      }

      // Prepare metadata
      const metadata = {
        asset_name: asset.metadata.name,
        asset_description: asset.metadata.description || "",
        asset_type: asset.metadata.type,
        asset_category: asset.metadata.category,
        author: asset.metadata.author,
        license: asset.metadata.license,
        version: asset.metadata.version,
        submitter_id: asset.metadata.author
      };

      formData.append("metadata", JSON.stringify(metadata));

      const result = await publishAssetToService({ formData });

      machines.publishing.send({
        type: "SUBMIT_SUCCESS",
        submissionId: result.id
      });

      // Update asset metadata to track submission
      const updatedAssets = new Map(deps.editedAssets());
      const updatedAsset = updatedAssets.get(assetId);
      if (updatedAsset) {
        updatedAsset.metadata.submission_id = result.id;
        updatedAsset.metadata.submission_status = "pending";
        updatedAsset.metadata.last_edited_after_publish = false;
        deps.setEditedAssets(updatedAssets);

        // Persist submission status
        try {
          await invoke("update_asset_metadata", {
            assetId: assetId,
            metadata: {
              ...updatedAsset.metadata,
              submission_id: result.id,
              submission_status: "pending",
              last_edited_after_publish: false
            }
          });
        } catch (err) {
          console.error("Failed to persist submission status:", err);
        }
      }

      await deps.logEvent(assetId, "published", {
        submission_id: result.id,
        asset_name: asset.metadata.name
      });

      deps.showMetadataSaveToast("Asset submitted successfully! Pending review.", 5000);

    } catch (error) {
      console.error("Failed to publish asset:", error);

      machines.publishing.send({
        type: "SUBMIT_FAILURE",
        error: String(error)
      });

      deps.showMetadataSaveToast(`Failed to publish: ${error}`, 5000);
    }
  };
};

/**
 * Handle submission review (moderator action)
 */
export const createReviewHandler = (deps: HandlerDependencies) => {
  return async (submissionId: string) => {
    const action = deps.reviewAction();

    if (!action) return;
    if (!deps.appSettings?.moderator_api_key) {
      alert("API key not configured. Please set it in Settings.");
      return;
    }

    deps.setSubmitting(true);

    try {
      await submitReview({
        submissionId,
        action,
        notes: deps.reviewNotes(),
        rejectionReason: deps.rejectionReason(),
        apiKey: deps.appSettings.moderator_api_key
      });

      deps.showMetadataSaveToast(
        `Submission ${action === "approve" ? "approved" : "rejected"} successfully!`,
        4000
      );

      // Reset form
      deps.setReviewAction(null);
      deps.setRejectionReason("");
      deps.setReviewNotes("");
      deps.setIsPanelOpen(false);

      // Refetch pending submissions
      await deps.fetchPendingSubmissions();

    } catch (error) {
      console.error("Review failed:", error);
      deps.showMetadataSaveToast(`Failed to submit review: ${error}`, 5000);
    } finally {
      deps.setSubmitting(false);
    }
  };
};

/**
 * Handle open downloads folder
 */
export const createOpenDownloadsFolderHandler = () => {
  return async () => {
    try {
      const appDataPath = await invoke<string>("get_app_data_path");
      const cachePath = `${appDataPath}/cache`;
      await invoke("open_folder", { path: cachePath });
    } catch (error) {
      console.error("Failed to open downloads folder:", error);
    }
  };
};

/**
 * Handle reload changed asset
 */
export const createReloadChangedAssetHandler = (deps: HandlerDependencies & { assets: any }) => {
  return () => {
    const assetId = deps.changedAssetId();
    if (!assetId) return;

    deps.setChangedAssetId(null);

    // Refresh the view if the asset detail panel is open
    if (deps.selectedAsset() && deps.selectedAsset()!.id === assetId) {
      deps.setIsPanelOpen(false);
      setTimeout(() => {
        const asset = deps.assets()?.find((a: Asset) => a.id === assetId);
        if (asset) {
          deps.setSelectedAsset(asset);
          deps.setIsPanelOpen(true);
        }
      }, 100);
    }

    deps.showMetadataSaveToast("✨ Asset reloaded from disk", 2000);
  };
};
