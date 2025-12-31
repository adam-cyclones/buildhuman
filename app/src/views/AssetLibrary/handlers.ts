/**
 * Event handlers for AssetLibrary
 * All user interaction handlers
 */

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { config } from "../../config";
import { publishAssetToService, submitReview, withdrawSubmission } from "./client";
import { hasMetadataChanges } from "./utils";
import { getEditingActor } from "./machines/assetEditingService";
import { getPublishingActor } from "./machines/assetPublishingService";
import type { Asset, LocalAsset, Download, AppSettings } from "./types";
import type { AssetLibraryState } from "./hooks/useAssetState";

const API_URL = config.apiUrl;

export interface HandlerDependencies extends AssetLibraryState {
  fetchCachedAssets: () => Promise<void>;
  showMetadataSaveToast: (message: string, duration?: number) => void;
  logEvent: (assetId: string, eventType: string, metadata?: any) => Promise<void>;
  fetchPendingSubmissions: () => Promise<void>;
  appSettings?: AppSettings | null;
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
          name: asset.name + " (copy)",
          author: deps.appSettings?.author_name || asset.author,
          file_size: undefined, // No file yet for new copy
          publish_date: "", // Not published yet, will be set when approved
          rating: 0, // Reset rating for new copy
          rating_count: 0,
          downloads: 0,
        };

    deps.setSelectedAsset(editedAsset);

    // Add to editing set
    deps.setEditingAssetIds(prev => new Set([...prev, editedAsset.id]));

    // Store the original for later copy creation (only if not already stored)
    if (!existingEdited) {
      deps.setOriginalEditedMetadata(prev => {
        const newMap = new Map(prev);
        newMap.set(editedAsset.id, { ...asset });
        return newMap;
      });

      // Machine will auto-start editing state for _editing assets
      // Mark metadata as changed since we changed the name
      getEditingActor(editedAsset.id).send({ type: "CHANGE_METADATA" });
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

        // Clear pending thumbnail if exists
        deps.setPendingThumbnails(prev => {
          const newMap = new Map(prev);
          newMap.delete(editedId);
          return newMap;
        });

        // Remove from editing set
        deps.setEditingAssetIds(prev => new Set([...prev].filter(id => id !== editedId)));

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

      // Clear pending thumbnail if exists
      deps.setPendingThumbnails(prev => {
        const newMap = new Map(prev);
        newMap.delete(editedId);
        return newMap;
      });

      // Remove from editing set
      deps.setEditingAssetIds(prev => new Set([...prev].filter(id => id !== editedId)));

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
    // Send SAVE event to editing machine
    getEditingActor(assetId).send({ type: "SAVE" });

    try {
      const updatedAsset = deps.selectedAsset();
      if (!updatedAsset) return;

      // Create editable copy if it doesn't exist yet OR if it's just a minimal preview entry
      let editedAsset = deps.editedAssets().get(assetId);

      if (!editedAsset || !editedAsset.file_path) {
        // Extract original asset ID (remove "_editing" suffix if present)
        const originalId = assetId.replace("_editing", "");

        console.log("Creating editable copy for save:", originalId);
        const newCopy = await invoke<LocalAsset>("create_editable_copy", { assetId: originalId });
        console.log("Created new copy with ID:", newCopy.metadata.id);

        // Add to edited assets map
        deps.setEditedAssets(prev => {
          const newMap = new Map(prev);
          newMap.set(newCopy.metadata.id, newCopy);
          return newMap;
        });

        // Update editingAssetIds Set: remove old temporary ID, add new real ID
        const oldTempId = assetId; // Save the old _editing ID
        deps.setEditingAssetIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(oldTempId); // Remove temporary _editing ID
          newSet.add(newCopy.metadata.id); // Add real timestamped ID
          return newSet;
        });

        // Update selected asset to use the real edited ID
        const realEditedAsset: Asset = {
          ...updatedAsset,
          id: newCopy.metadata.id,
        };
        deps.setSelectedAsset(realEditedAsset);

        editedAsset = newCopy;
        assetId = newCopy.metadata.id;
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

      // Save pending thumbnail if exists
      const pendingThumbnailPath = deps.pendingThumbnails().get(assetId);
      if (pendingThumbnailPath) {
        await invoke("set_asset_thumbnail", {
          assetId,
          thumbnailPath: pendingThumbnailPath
        });

        const thumbnailFilename = await invoke<string>("get_asset_thumbnail", { assetId });

        // Update metadata with real thumbnail filename
        metadata.thumbnail_url = thumbnailFilename;

        // Update selected asset with real filename
        const updatedAssetWithThumb = { ...updatedAsset };
        updatedAssetWithThumb.thumbnail_url = thumbnailFilename;
        deps.setSelectedAsset(updatedAssetWithThumb);

        // Update edited assets map with real filename
        if (deps.editedAssets().has(assetId)) {
          deps.setEditedAssets(prev => {
            const newMap = new Map(prev);
            const asset = newMap.get(assetId);
            if (asset) {
              asset.metadata.thumbnail_url = thumbnailFilename;
            }
            return newMap;
          });
        }

        // Clear pending thumbnail
        deps.setPendingThumbnails(prev => {
          const newMap = new Map(prev);
          newMap.delete(assetId);
          return newMap;
        });

        // Update thumbnail timestamp for cache-busting
        deps.setThumbnailTimestamps(prev => {
          const newMap = new Map(prev);
          newMap.set(assetId, Date.now());
          localStorage.setItem("thumbnailTimestamps", JSON.stringify(Object.fromEntries(newMap)));
          return newMap;
        });
      }

      // Check publishing machine state
      const pubSnapshot = getPublishingActor(assetId, editedAsset?.metadata).getSnapshot();
      const isPending = pubSnapshot.matches("pending");
      if (isPending) {
        getPublishingActor(assetId, editedAsset?.metadata).send({ type: "EDIT" });
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

      // Update editedAssets map with the saved metadata
      deps.setEditedAssets(prev => {
        const newMap = new Map(prev);
        const asset = newMap.get(assetId);
        if (asset) {
          asset.metadata = { ...asset.metadata, ...metadata };
        }
        return newMap;
      });

      console.log("Save completed successfully for asset:", assetId);

      // Send SAVE_SUCCESS to editing machine
      getEditingActor(assetId).send({ type: "SAVE_SUCCESS" });

      // Log event
      await deps.logEvent(assetId, isPending ? "edited_after_publish" : "metadata_saved", {
        fields: Object.keys(metadata).filter(k => k !== 'id')
      });

      // Update the original metadata to reflect saved state
      deps.setOriginalEditedMetadata(new Map(deps.originalEditedMetadata().set(assetId, { ...updatedAsset })));
    } catch (error) {
      console.error("Failed to save metadata:", error);

      // Send SAVE_FAILURE to editing machine
      getEditingActor(assetId).send({ type: "SAVE_FAILURE", error: String(error) });

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
        // Store the pending thumbnail path (don't save to disk yet)
        deps.setPendingThumbnails(prev => {
          const newMap = new Map(prev);
          newMap.set(assetId, selected);
          return newMap;
        });

        // Send CHANGE_THUMBNAIL event to editing machine
        getEditingActor(assetId).send({ type: "CHANGE_THUMBNAIL" });

        // Use the selected file path directly for preview (will be converted by convertFileSrc)
        // Prefix with "pending:" so we know it's not saved yet
        const pendingUrl = `pending:${selected}`;

        // Update the selected asset for preview (temporary, not saved yet)
        const updatedAsset = { ...deps.selectedAsset()! };
        updatedAsset.thumbnail_url = pendingUrl;
        deps.setSelectedAsset(updatedAsset);

        // Update the editedAssets map for preview (so card updates immediately)
        deps.setEditedAssets(prev => {
          const newMap = new Map(prev);
          const existingAsset = newMap.get(assetId);

          if (existingAsset) {
            // Asset already in editedAssets, update it
            const updatedLocalAsset = {
              ...existingAsset,
              metadata: {
                ...existingAsset.metadata,
                thumbnail_url: pendingUrl
              }
            };
            newMap.set(assetId, updatedLocalAsset);
          } else {
            // Asset not in editedAssets yet, create minimal entry for preview
            // (no files on disk yet, just metadata for display)
            const minimalAsset: LocalAsset = {
              metadata: {
                ...updatedAsset,
                thumbnail_url: pendingUrl
              },
              file_path: "", // No file on disk yet
              downloaded_at: new Date().toISOString(),
              cached: false,
              is_edited: false, // Not truly edited yet, just has pending thumbnail
            };
            newMap.set(assetId, minimalAsset);
          }

          return newMap;
        });

        // Note: Thumbnail will be saved when user clicks Save button

        deps.showMetadataSaveToast("Thumbnail selected (click Save to apply)", 2000);

        // Log thumbnail change event
        await deps.logEvent(assetId, "thumbnail_selected", {
          path: selected
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
    console.log("Publishing asset with ID:", assetId);
    console.log("Available edited assets:", Array.from(deps.editedAssets().keys()));

    const asset = deps.editedAssets().get(assetId);
    if (!asset) {
      console.error("Asset not found in editedAssets map for ID:", assetId);
      alert("Asset not found");
      return;
    }

    getPublishingActor(assetId, asset.metadata).send({ type: "SUBMIT" });

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

      getPublishingActor(assetId, asset.metadata).send({
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

      getPublishingActor(assetId, asset.metadata).send({
        type: "SUBMIT_FAILURE",
        error: String(error)
      });

      deps.showMetadataSaveToast(`Failed to publish: ${error}`, 5000);
    }
  };
};

/**
 * Handle withdrawal of pending submission
 */
export const createWithdrawSubmissionHandler = (deps: HandlerDependencies) => {
  return async (assetId: string) => {
    // Show custom confirmation dialog instead of browser confirm
    deps.setConfirmDialog({
      isOpen: true,
      title: "Withdraw Submission",
      message: "Are you sure you want to withdraw this submission?\n\nYour asset will be removed from review and you can continue editing and resubmit when ready.",
      variant: "warning",
      onConfirm: async () => {
        // Close dialog
        deps.setConfirmDialog(null);

        try {
          const editedAsset = deps.editedAssets().get(assetId);
          if (!editedAsset) {
            throw new Error("Edited asset not found");
          }

          // Get submission ID from metadata
          const submissionId = editedAsset.metadata.submission_id;
          if (!submissionId) {
            throw new Error("No submission ID found");
          }

          // Get submitter ID from settings
          const submitterId = deps.appSettings?.author_name || undefined;

          // Call API to withdraw
          await withdrawSubmission({ submissionId, submitterId });

          deps.showMetadataSaveToast("Submission withdrawn successfully", 3000);

          // Update state machine - transition to withdrawn, then back to editing
          const actor = getPublishingActor(assetId, editedAsset.metadata);
          actor.send({ type: "WITHDRAW" });
          actor.send({ type: "EDIT" });

          // Clear submission_id from metadata so it can be resubmitted
          const updatedMetadata = { ...editedAsset.metadata };
          delete updatedMetadata.submission_id;
          delete updatedMetadata.submission_status;

          // Update local state - create new Map for reactivity
          const updatedEditedAsset = {
            ...editedAsset,
            metadata: updatedMetadata
          };
          const newEditedAssets = new Map(deps.editedAssets());
          newEditedAssets.set(assetId, updatedEditedAsset);
          deps.setEditedAssets(newEditedAssets);

          // Save metadata to disk
          await invoke("update_asset_metadata", {
            assetId,
            metadata: updatedMetadata
          });

          // Refresh pending submissions if viewing them
          if (deps.selectedType() === "pending") {
            await deps.fetchPendingSubmissions();
          }

          // Close panel
          deps.setIsPanelOpen(false);

        } catch (error) {
          console.error("Failed to withdraw submission:", error);
          deps.showMetadataSaveToast(
            `Failed to withdraw: ${error instanceof Error ? error.message : String(error)}`,
            5000
          );
        }
      }
    });
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
 * Handle batch approval of submissions
 */
export const createBatchApproveHandler = (deps: HandlerDependencies) => {
  return async () => {
    const selectedIds = Array.from(deps.selectedSubmissions());

    if (selectedIds.length === 0) return;
    if (!deps.appSettings?.moderator_api_key) {
      alert("API key not configured. Please set it in Settings.");
      return;
    }

    deps.setSubmitting(true);

    try {
      // Process all approvals in parallel
      await Promise.all(
        selectedIds.map(submissionId =>
          submitReview({
            submissionId,
            action: "approve",
            apiKey: deps.appSettings!.moderator_api_key
          })
        )
      );

      deps.showMetadataSaveToast(
        `${selectedIds.length} submission${selectedIds.length > 1 ? 's' : ''} approved successfully!`,
        4000
      );

      // Clear selection
      deps.setSelectedSubmissions(new Set<string>());
      deps.setIsPanelOpen(false);

      // Refetch pending submissions
      await deps.fetchPendingSubmissions();

    } catch (error) {
      console.error("Batch approval failed:", error);
      deps.showMetadataSaveToast(`Failed to approve submissions: ${error}`, 5000);
    } finally {
      deps.setSubmitting(false);
    }
  };
};

/**
 * Handle batch rejection of submissions
 */
export const createBatchRejectHandler = (deps: HandlerDependencies) => {
  return async () => {
    const selectedIds = Array.from(deps.selectedSubmissions());

    if (selectedIds.length === 0) return;
    if (!deps.appSettings?.moderator_api_key) {
      alert("API key not configured. Please set it in Settings.");
      return;
    }

    // Prompt for rejection reason
    const reason = prompt("Rejection reason (required):\n\nOptions: quality, inappropriate, copyright, incomplete, other");
    if (!reason) return;

    deps.setSubmitting(true);

    try {
      // Process all rejections in parallel
      await Promise.all(
        selectedIds.map(submissionId =>
          submitReview({
            submissionId,
            action: "reject",
            rejectionReason: reason,
            apiKey: deps.appSettings!.moderator_api_key
          })
        )
      );

      deps.showMetadataSaveToast(
        `${selectedIds.length} submission${selectedIds.length > 1 ? 's' : ''} rejected successfully!`,
        4000
      );

      // Clear selection
      deps.setSelectedSubmissions(new Set<string>());
      deps.setIsPanelOpen(false);

      // Refetch pending submissions
      await deps.fetchPendingSubmissions();

    } catch (error) {
      console.error("Batch rejection failed:", error);
      deps.showMetadataSaveToast(`Failed to reject submissions: ${error}`, 5000);
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
