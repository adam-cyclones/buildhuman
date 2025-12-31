import { For, onMount, createResource, createEffect, on, createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import AssetGrid from "./components/AssetGrid";
import AssetFilters from "./components/AssetFilters";
import AssetDetailPanel from "./components/AssetDetailPanel";
import ReleaseModal from "./components/ReleaseModal";
import { useAssetEvents } from "./components/useAssetEvents";
import Icon from "../../components/Icon";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useAssetState } from "./hooks/useAssetState";
import { fetchAssets, fetchCategories, fetchPendingSubmissions, fetchCachedAssets } from "./client";
import { getEditingActor } from "./machines/assetEditingService";
import { config } from "../../config";
import {
  isEditingAsset,
  isLicenseEditable,
  convertToAssetPath,
  mergeAndSortAssets,
  filterCategories
} from "./utils";
import {
  createDownloadHandler,
  createAssetClickHandler,
  createClosePanelHandler,
  createDeleteCachedAssetHandler,
  createEditAssetHandler,
  createRevertToOriginalHandler,
  createOpenInBlenderHandler,
  createSaveMetadataHandler,
  createChangeThumbnailHandler,
  createPublishAssetHandler,
  createWithdrawSubmissionHandler,
  createReviewHandler,
  createBatchApproveHandler,
  createBatchRejectHandler,
  createOpenDownloadsFolderHandler,
  createReloadChangedAssetHandler
} from "./handlers";
import type { AssetLibraryProps, Asset } from "./types";
import "./AssetLibrary.css";

const AssetLibrary = (props: AssetLibraryProps) => {
  // Initialize all state
  const state = useAssetState();

  // Release modal state
  const [isReleaseModalOpen, setIsReleaseModalOpen] = createSignal(false);

  // Create resource for assets with dynamic params
  const [assets, { refetch }] = createResource(() => ({
    selectedCategory: state.selectedCategory(),
    searchQuery: state.searchQuery(),
    sortBy: state.sortBy()
  }), fetchAssets);

  const [categories] = createResource(fetchCategories);

  // Event logging system
  const { logEvent, getRecentEvents } = useAssetEvents(state.editedAssets, state.setEditedAssets);

  // Helper to show toast messages
  const showMetadataSaveToast = (message: string, duration: number = 3000) => {
    state.setMetadataToastMessage(message);
    state.setShowMetadataToast(true);
    setTimeout(() => state.setShowMetadataToast(false), duration);
  };

  // Fetch cached assets helper
  const loadCachedAssets = async () => {
    try {
      const cached = await fetchCachedAssets();
      const assetIds = cached.map(asset => asset.metadata.id);
      state.setCachedAssets(new Set(assetIds));

      // Populate edited assets map
      const edited = cached.filter(asset =>
        asset.is_edited || asset.metadata.id.endsWith("_editing") || asset.metadata.id.includes("_edited_")
      );

      console.log("✏️ Edited assets found:", edited);

      state.setEditedAssets(prev => {
        const newMap = new Map(prev);
        edited.forEach(asset => {
          newMap.set(asset.metadata.id, asset);
        });
        return newMap;
      });

      // Populate editing asset IDs set
      const editingIds = edited.map(asset => asset.metadata.id);
      state.setEditingAssetIds(new Set(editingIds));
    } catch (error) {
      console.error("Failed to fetch cached assets:", error);
    }
  };

  // Fetch pending submissions helper
  const loadPendingSubmissions = async () => {
    const submissions = await fetchPendingSubmissions(props.appSettings || undefined);
    state.setPendingSubmissions(submissions);
  };

  // Create all event handlers
  const handlerDeps = {
    ...state,
    fetchCachedAssets: loadCachedAssets,
    showMetadataSaveToast,
    logEvent,
    fetchPendingSubmissions: loadPendingSubmissions,
    appSettings: props.appSettings
  };

  const handleDownload = createDownloadHandler(handlerDeps);
  const handleAssetClick = createAssetClickHandler(state);
  const handleClosePanel = createClosePanelHandler(state);
  const handleDeleteCachedAsset = createDeleteCachedAssetHandler(handlerDeps);
  const handleEditAsset = createEditAssetHandler(handlerDeps);
  const handleRevertToOriginal = createRevertToOriginalHandler(handlerDeps);
  const handleOpenInBlender = createOpenInBlenderHandler(handlerDeps);
  const handleSaveMetadata = createSaveMetadataHandler(handlerDeps);
  const handleChangeThumbnail = createChangeThumbnailHandler(handlerDeps);
  const handlePublishAsset = createPublishAssetHandler(handlerDeps);
  const handleWithdrawSubmission = createWithdrawSubmissionHandler(handlerDeps);
  const handleReview = createReviewHandler(handlerDeps);
  const handleBatchApprove = createBatchApproveHandler(handlerDeps);
  const handleBatchReject = createBatchRejectHandler(handlerDeps);
  const handleOpenDownloadsFolder = createOpenDownloadsFolderHandler();
  const handleReloadChangedAsset = createReloadChangedAssetHandler({ ...handlerDeps, assets });

  const handleOpenSettings = () => {
    // Check if current asset is being edited (even without changes)
    const currentAsset = state.selectedAsset();
    if (currentAsset && isEditingAsset(currentAsset.id, state.editingAssetIds())) {
      const snapshot = getEditingActor(currentAsset.id).getSnapshot();
      // Warn if in editing mode (includes newly created copies)
      if (snapshot.matches("editing") || snapshot.context.hasUnsavedChanges) {
        const confirmed = confirm(
          "You have an asset open for editing. Progress will be lost if you navigate away. Do you want to continue?"
        );
        if (!confirmed) return;
      }
    }

    if (props.onTabChange) {
      props.onTabChange("Settings");
    }
  };

  // Handler for publishing a release
  const handlePublishRelease = async (releaseData: {
    name: string;
    version: string;
    description: string;
    assetIds: string[];
  }) => {
    if (!props.appSettings?.moderator_api_key) {
      throw new Error("Moderator API key is required to publish releases");
    }

    const response = await fetch(`${config.apiUrl}/api/releases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": props.appSettings.moderator_api_key,
      },
      body: JSON.stringify({
        name: releaseData.name,
        version: releaseData.version,
        description: releaseData.description,
        asset_ids: releaseData.assetIds,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to publish release: ${error}`);
    }

    const result = await response.json();
    console.log("Release published successfully:", result);

    // Optionally refetch assets to show updated metadata
    refetch();
  };

  // Auto-refetch when filters change
  createEffect(
    on(
      [state.sortBy, state.selectedCategory, state.searchQuery],
      () => {
        refetch();
      },
      { defer: true }
    )
  );

  // Fetch pending submissions when type changes to "pending"
  createEffect(
    on(
      state.selectedType,
      (type) => {
        if (type === "pending") {
          loadPendingSubmissions();
        }
      }
    )
  );

  // Handle notification click - open specific pending submission
  createEffect(
    on(
      () => props.pendingSubmissionId,
      (submissionId) => {
        if (submissionId) {
          // Switch to pending view
          state.setSelectedType("pending");

          // Wait for submissions to load, then open the detail panel
          setTimeout(() => {
            const submission = state.pendingSubmissions().find(s => s.id === submissionId);
            if (submission) {
              // Convert submission to Asset format
              const assetFromSubmission: Asset = {
                id: submission.id,
                name: submission.asset_name,
                description: submission.asset_description || "",
                type: submission.asset_type,
                category: submission.asset_category,
                author: submission.author,
                rating: 0,
                rating_count: 0,
                license: submission.license,
                publish_date: submission.submitted_at,
                downloads: 0,
                file_size: submission.file_size || 0,
                version: submission.version,
                required: false,
                thumbnail_url: submission.thumbnail_path || ""
              };
              handleAssetClick(assetFromSubmission);
            }

            // Clear the signal
            if (props.onSubmissionOpened) {
              props.onSubmissionOpened();
            }
          }, 500);
        }
      }
    )
  );

  // Merge API assets with local edited assets
  // Get candidate assets for releases (published, non-required assets only)
  const candidateAssets = () => {
    const apiAssets = assets() || [];
    return apiAssets.filter((asset: Asset) => !asset.required && asset.submission_status !== "pending");
  };

  const allAssets = () => {
    const apiAssets = assets() || [];
    const localAssets = Array.from(state.editedAssets().values());
    let merged = mergeAndSortAssets(apiAssets, localAssets, state.selectedType(), state.pendingSubmissions());

    // Apply client-side filtering for pending submissions and my creations
    if (state.selectedType() === "pending" || state.selectedType() === "my-creations") {
      const searchLower = state.searchQuery().toLowerCase();

      // Filter to only edited/created assets for "my-creations"
      if (state.selectedType() === "my-creations") {
        merged = merged.filter(asset => asset.id.includes("_edited_"));
      }

      // Filter by search query
      if (searchLower) {
        merged = merged.filter(asset =>
          asset.name.toLowerCase().includes(searchLower) ||
          asset.description?.toLowerCase().includes(searchLower) ||
          asset.author.toLowerCase().includes(searchLower)
        );
      }

      // Filter by category
      if (state.selectedCategory() !== "all") {
        merged = merged.filter(asset => asset.category === state.selectedCategory());
      }

      // Apply sorting
      const sortBy = state.sortBy();
      merged.sort((a, b) => {
        switch (sortBy) {
          case "name":
            return a.name.localeCompare(b.name);
          case "date":
            return new Date(b.publish_date).getTime() - new Date(a.publish_date).getTime();
          case "downloads":
            return (b.downloads || 0) - (a.downloads || 0);
          case "rating":
            return (b.rating || 0) - (a.rating || 0);
          default:
            return 0;
        }
      });
    }

    return merged;
  };

  // Filter categories by selected type
  const filteredCategories = () => {
    return filterCategories(categories() || [], state.selectedType());
  };

  // Convert thumbnail paths
  const convertPath = (thumbnailUrl: string, bustCache = false) => {
    return convertToAssetPath(thumbnailUrl, state.appDataPath(), bustCache);
  };

  // Lifecycle
  onMount(async () => {
    // Get app data path
    try {
      const path = await invoke<string>("get_app_data_path");
      state.setAppDataPath(path);
    } catch (error) {
      console.error("Failed to get app data path:", error);
    }

    // Load thumbnail timestamps from localStorage
    try {
      const stored = localStorage.getItem("thumbnailTimestamps");
      if (stored) {
        const parsed = JSON.parse(stored);
        state.setThumbnailTimestamps(new Map(Object.entries(parsed).map(([k, v]) => [k, v as number])));
      }
    } catch (error) {
      console.error("Failed to load thumbnail timestamps:", error);
    }

    // Fetch cached assets
    await loadCachedAssets();

    // Listen for asset file changes
    const unlisten = await listen<string>("asset-file-changed", (event) => {
      console.log("Asset file changed:", event.payload);
      const assetId = event.payload;

      state.setChangedAssetId(assetId);

      // Auto-hide notification after 10 seconds
      setTimeout(() => {
        if (state.changedAssetId() === assetId) {
          state.setChangedAssetId(null);
        }
      }, 10000);
    });

    // Return cleanup function
    return () => {
      unlisten();
    };
  });

  return (
    <div class="asset-library">
      {state.changedAssetId() && (
        <div class="asset-changed-banner">
          <div class="banner-content">
            <Icon name="eye" size={20} />
            <span>
              Asset "{state.editedAssets().get(state.changedAssetId()!)?.metadata.name || state.changedAssetId()}" has been updated externally.
            </span>
          </div>
          <div class="banner-actions">
            <button class="reload-btn" onClick={handleReloadChangedAsset}>
              <Icon name="reload" size={16} />
              Reload
            </button>
            <button class="dismiss-btn" onClick={() => state.setChangedAssetId(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      )}

      <AssetFilters
        searchQuery={state.searchQuery}
        setSearchQuery={state.setSearchQuery}
        sortBy={state.sortBy}
        setSortBy={state.setSortBy}
        selectedType={state.selectedType}
        setSelectedType={state.setSelectedType}
        selectedCategory={state.selectedCategory}
        setSelectedCategory={state.setSelectedCategory}
        filteredCategories={filteredCategories}
        assetCount={assets()?.length || 0}
        onSearch={() => refetch()}
        showModeratorOptions={props.appSettings?.moderator_mode && !!props.appSettings?.moderator_api_key}
        viewMode={state.viewMode}
        setViewMode={state.setViewMode}
      />

      {state.selectedType() === "pending" && (
        <div class="pending-submissions-header">
          <div class="pending-header-content">
            <Icon name="shield" size={24} />
            <div>
              <h2>Pending Submissions</h2>
              <p>Review community-submitted assets awaiting moderation</p>
            </div>
          </div>
          <div class="pending-actions">
            {state.selectedSubmissions().size > 0 && (
              <>
                <span class="selected-count">
                  {state.selectedSubmissions().size} selected
                </span>
                <button
                  class="batch-action-btn approve"
                  onClick={handleBatchApprove}
                  disabled={state.submitting()}
                >
                  <Icon name="check" size={16} />
                  Approve All
                </button>
                <button
                  class="batch-action-btn reject"
                  onClick={handleBatchReject}
                  disabled={state.submitting()}
                >
                  <Icon name="x-circle" size={16} />
                  Reject All
                </button>
                <button
                  class="batch-action-btn clear"
                  onClick={() => state.setSelectedSubmissions(new Set())}
                >
                  Clear Selection
                </button>
              </>
            )}
            <div class="pending-count">
              {state.pendingSubmissions().length} submission{state.pendingSubmissions().length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}

      <AssetGrid
        assets={allAssets}
        loading={assets.loading}
        error={assets.error}
        viewMode={state.viewMode}
        selectedType={state.selectedType}
        apiUrl={config.apiUrl}
        onAssetClick={handleAssetClick}
        convertToAssetPath={convertPath}
        thumbnailTimestamps={state.thumbnailTimestamps}
        cachedAssets={state.cachedAssets}
        downloading={state.downloading}
        onDownload={handleDownload}
        editedAssets={state.editedAssets}
        allAssets={() => assets() || []}
        onPublishAsset={handlePublishAsset}
        selectedSubmissions={state.selectedSubmissions}
        onToggleSubmissionSelect={(id: string) => {
          state.setSelectedSubmissions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
              newSet.delete(id);
            } else {
              newSet.add(id);
            }
            return newSet;
          });
        }}
      />

      <div class="asset-pagination">
        <div class="status-bar-buttons">
          {props.appSettings?.moderator_mode && !!props.appSettings?.moderator_api_key && (
            <button
              class="publish-btn"
              title="Create and publish a new release"
              onClick={() => setIsReleaseModalOpen(true)}
            >
              <Icon name="rocket" size={16} />
              Release
            </button>
          )}
          <div class="downloads-wrapper">
            <button
              class="downloads-btn"
              onClick={() => state.setIsDownloadsPanelOpen(!state.isDownloadsPanelOpen())}
            >
              <Icon name="download" size={16} />
              <span>Downloads</span>
              {state.downloadQueue().filter((d) => d.status === "downloading").length > 0 && (
                <span class="downloads-badge">
                  {state.downloadQueue().filter((d) => d.status === "downloading").length}
                </span>
              )}
            </button>
            {state.isDownloadsPanelOpen() && (
              <div class="downloads-popup downloads-popup-bottom">
                <div class="downloads-popup-header">
                  <h3>Downloads</h3>
                  <div class="downloads-header-buttons">
                    <button
                      class="open-folder-btn"
                      onClick={handleOpenDownloadsFolder}
                      title="Open downloads folder"
                    >
                      <Icon name="folder" size={14} />
                    </button>
                    {state.downloadQueue().length > 0 && (
                      <button
                        class="clear-downloads-btn"
                        onClick={() =>
                          state.setDownloadQueue(
                            state.downloadQueue().filter((d) => d.status === "downloading")
                          )
                        }
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <div class="downloads-list">
                  {state.downloadQueue().length === 0 ? (
                    <div class="downloads-empty">No downloads</div>
                  ) : (
                    <For each={state.downloadQueue()}>
                      {(download) => (
                        <div
                          class={`download-item ${download.status}`}
                        >
                          <div class="download-icon">
                            {download.status === "downloading" && (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                class="spinner"
                              >
                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" opacity="0.4" />
                                <path d="M12 2v4" opacity="1" />
                              </svg>
                            )}
                            {download.status === "completed" && (
                              <Icon name="check" size={16} />
                            )}
                            {download.status === "failed" && (
                              <Icon name="x-circle" size={16} />
                            )}
                          </div>
                          <div class="download-info">
                            <div class="download-name">{download.name}</div>
                            <div class="download-time">{download.timestamp && new Date(download.timestamp).toLocaleString()}</div>
                            {download.error && (
                              <div class="download-error">{download.error}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </For>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {state.isPanelOpen() && state.selectedAsset() && (
        <AssetDetailPanel
          selectedAsset={state.selectedAsset}
          setSelectedAsset={state.setSelectedAsset}
          isEditingAsset={(id) => isEditingAsset(id, state.editingAssetIds())}
          editedAssets={state.editedAssets}
          cachedAssets={state.cachedAssets}
          originalEditedMetadata={state.originalEditedMetadata}
          convertToAssetPath={convertPath}
          thumbnailTimestamps={state.thumbnailTimestamps}
          getRecentEvents={getRecentEvents}
          selectedType={state.selectedType}
          downloading={state.downloading}
          reviewAction={state.reviewAction}
          setReviewAction={state.setReviewAction}
          rejectionReason={state.rejectionReason}
          setRejectionReason={state.setRejectionReason}
          reviewNotes={state.reviewNotes}
          setReviewNotes={state.setReviewNotes}
          submitting={state.submitting}
          appSettings={props.appSettings}
          onClose={handleClosePanel}
          onChangeThumbnail={handleChangeThumbnail}
          onOpenInBlender={handleOpenInBlender}
          onSaveMetadata={handleSaveMetadata}
          onPublishAsset={handlePublishAsset}
          onWithdrawSubmission={handleWithdrawSubmission}
          onDeleteCached={handleDeleteCachedAsset}
          onRevertToOriginal={handleRevertToOriginal}
          onReview={handleReview}
          onDownload={handleDownload}
          onEditAsset={handleEditAsset}
          onOpenSettings={handleOpenSettings}
          isLicenseEditable={isLicenseEditable}
          showMetadataSaveToast={showMetadataSaveToast}
        />
      )}

      {state.showMetadataToast() && (
        <div class="settings-toast">
          <Icon name="check" size={16} />
          <span>{state.metadataToastMessage()}</span>
        </div>
      )}

      {state.confirmDialog() && (
        <ConfirmDialog
          isOpen={state.confirmDialog()?.isOpen || false}
          title={state.confirmDialog()?.title || ""}
          message={state.confirmDialog()?.message || ""}
          variant={state.confirmDialog()?.variant}
          onConfirm={state.confirmDialog()?.onConfirm || (() => {})}
          onCancel={() => state.setConfirmDialog(null)}
        />
      )}

      <ReleaseModal
        isOpen={isReleaseModalOpen()}
        onClose={() => setIsReleaseModalOpen(false)}
        availableAssets={candidateAssets()}
        onPublishRelease={handlePublishRelease}
      />
    </div>
  );
};

export default AssetLibrary;
