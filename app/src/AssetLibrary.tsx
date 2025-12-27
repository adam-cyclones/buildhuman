import { createSignal, For, onMount, createResource, createEffect, on } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import "./AssetLibrary.css";

interface Asset {
  id: string;
  name: string;
  description?: string;
  type: string;
  category: string;
  author: string;
  rating: number;
  rating_count: number;
  license: string;
  publish_date: string;
  downloads: number;
  file_size?: number;
  version: string;
  required: boolean;
}

interface Category {
  id: string;
  name: string;
  type_id: string;
}

interface Download {
  id: string;
  name: string;
  status: "downloading" | "completed" | "failed";
  timestamp: number;
  error?: string;
}

const API_URL = "http://localhost:8000";

const AssetLibrary = () => {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [sortBy, setSortBy] = createSignal("recent");
  const [selectedType, setSelectedType] = createSignal("all");
  const [selectedCategory, setSelectedCategory] = createSignal("all");
  const [downloading, setDownloading] = createSignal<string | null>(null);
  const [selectedAsset, setSelectedAsset] = createSignal<Asset | null>(null);
  const [isPanelOpen, setIsPanelOpen] = createSignal(false);
  const [downloadQueue, setDownloadQueue] = createSignal<Download[]>([]);
  const [isDownloadsPanelOpen, setIsDownloadsPanelOpen] = createSignal(false);
  const [showFilters, setShowFilters] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<"grid" | "list">("grid");
  const [cachedAssets, setCachedAssets] = createSignal<Set<string>>(new Set());
  const [editedAssets, setEditedAssets] = createSignal<Map<string, LocalAsset>>(new Map());
  const [showMetadataToast, setShowMetadataToast] = createSignal(false);
  const [metadataToastMessage, setMetadataToastMessage] = createSignal("");
  const [defaultEditor, setDefaultEditor] = createSignal<string>("");
  const [defaultEditorType, setDefaultEditorType] = createSignal<string>("");
  const [originalEditedMetadata, setOriginalEditedMetadata] = createSignal<Map<string, Asset>>(new Map());

  // Fetch assets from API
  const fetchAssets = async () => {
    const params = new URLSearchParams();

    if (selectedCategory() !== "all") {
      params.append("category", selectedCategory());
    }
    if (searchQuery()) {
      params.append("search", searchQuery());
    }
    params.append("sort", sortBy());

    const url = `${API_URL}/api/assets?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Failed to fetch assets");
    }

    return response.json();
  };

  // Fetch categories
  const fetchCategories = async () => {
    const response = await fetch(`${API_URL}/api/categories`);
    if (!response.ok) {
      throw new Error("Failed to fetch categories");
    }
    return response.json();
  };

  const [assets, { refetch }] = createResource(fetchAssets);
  const [categories] = createResource(fetchCategories);

  // Debug logging
  const logAssets = () => {
    if (assets()) {
      console.log("Assets loaded:", assets());
      console.log("First asset:", assets()[0]);
    }
  };

  // Log when assets change
  createEffect(() => {
    logAssets();
  });

  // Auto-refetch when sort/category changes (skip initial run)
  createEffect(
    on(
      [sortBy, selectedCategory, searchQuery],
      () => {
        refetch();
      },
      { defer: true }
    )
  );

  // Refetch when filters change
  const handleSearch = () => {
    refetch();
  };

  interface LocalAsset {
    metadata: {
      id: string;
      name: string;
      [key: string]: any;
    };
    file_path: string;
    downloaded_at: string;
    cached: boolean;
    is_edited: boolean;
    original_id?: string;
  }

  const fetchCachedAssets = async () => {
    try {
      const cached = await invoke<LocalAsset[]>("list_cached_assets");
      const assetIds = cached.map(asset => asset.metadata.id);
      setCachedAssets(new Set(assetIds));
    } catch (error) {
      console.error("Failed to fetch cached assets:", error);
    }
  };

  const loadSettings = async () => {
    try {
      const settings = await invoke<{ default_editor: string; default_editor_type: string }>("get_app_settings");
      setDefaultEditor(settings.default_editor);
      setDefaultEditorType(settings.default_editor_type);
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  };

  onMount(() => {
    // Fetch cached assets and settings
    fetchCachedAssets();
    loadSettings();
  });

  const handleDownload = async (assetId: string, assetName: string) => {
    // Add to download queue
    const download: Download = {
      id: assetId,
      name: assetName,
      status: "downloading",
      timestamp: Date.now(),
    };
    setDownloadQueue([download, ...downloadQueue()]);
    setIsDownloadsPanelOpen(true);

    try {
      setDownloading(assetId);

      // Start download and minimum display time in parallel
      const startTime = Date.now();
      const minDisplayTime = 800; // Minimum spinner display time in ms

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
      setDownloadQueue(
        downloadQueue().map((d) =>
          d.id === assetId ? { ...d, status: "completed" as const } : d
        )
      );

      // Update cached assets list
      await fetchCachedAssets();
    } catch (error) {
      console.error("Download failed:", error);

      // Update download status to failed
      setDownloadQueue(
        downloadQueue().map((d) =>
          d.id === assetId
            ? { ...d, status: "failed" as const, error: String(error) }
            : d
        )
      );
    } finally {
      setDownloading(null);
    }
  };

  const handleAssetClick = (asset: Asset) => {
    setSelectedAsset(asset);
    setIsPanelOpen(true);
  };

  const handleClosePanel = () => {
    setIsPanelOpen(false);
  };

  const handleDeleteCachedAsset = async (assetId: string, assetName: string) => {
    if (!confirm(`Delete "${assetName}" from cache?`)) {
      return;
    }

    try {
      await invoke("delete_cached_asset", { assetId });
      await fetchCachedAssets();
      setIsPanelOpen(false);
    } catch (error) {
      console.error("Failed to delete asset:", error);
      alert(`Failed to delete: ${error}`);
    }
  };

  const handleEditAsset = async (assetId: string) => {
    try {
      const editedCopy = await invoke<LocalAsset>("create_editable_copy", { assetId });

      // Add to edited assets map
      setEditedAssets(prev => {
        const newMap = new Map(prev);
        newMap.set(editedCopy.metadata.id, editedCopy);
        return newMap;
      });

      // Switch to viewing the edited version with updated metadata
      const editedAsset: Asset = {
        ...selectedAsset()!,
        id: editedCopy.metadata.id,
        name: editedCopy.metadata.name,
        author: editedCopy.metadata.author, // Use the author from settings
      };
      setSelectedAsset(editedAsset);

      // Store the original metadata for comparison later
      setOriginalEditedMetadata(prev => {
        const newMap = new Map(prev);
        newMap.set(editedCopy.metadata.id, { ...editedAsset });
        return newMap;
      });
    } catch (error) {
      console.error("Failed to create editable copy:", error);
      alert(`Failed to create editable copy: ${error}`);
    }
  };

  const handleRevertToOriginal = async (editedId: string) => {
    // Only show confirmation if changes were made
    if (hasMetadataChanges(editedId)) {
      if (!confirm("Revert to original? This will discard your changes.")) {
        return;
      }
    }

    try {
      await invoke("revert_to_original", { editedId });

      // Remove from edited assets map
      setEditedAssets(prev => {
        const newMap = new Map(prev);
        newMap.delete(editedId);
        return newMap;
      });

      // Remove from original metadata map
      setOriginalEditedMetadata(prev => {
        const newMap = new Map(prev);
        newMap.delete(editedId);
        return newMap;
      });

      setIsPanelOpen(false);
    } catch (error) {
      console.error("Failed to revert to original:", error);
      alert(`Failed to revert: ${error}`);
    }
  };

  const getEditorDisplayName = () => {
    const type = defaultEditorType();
    if (!type) return "Editor";
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const isLicenseEditable = (license: string) => {
    const licenseUpper = license.toUpperCase();
    // Check for non-derivative licenses (ND = No Derivatives)
    if (licenseUpper.includes("ND") || licenseUpper.includes("NO DERIV")) {
      return false;
    }
    // Check for other restrictive terms
    if (licenseUpper.includes("ALL RIGHTS RESERVED") || licenseUpper.includes("NO MODIFICATION")) {
      return false;
    }
    // By default, allow editing (CC-BY, CC-BY-SA, MIT, GPL, etc. are permissive)
    return true;
  };

  const hasMetadataChanges = (editedId: string) => {
    const original = originalEditedMetadata().get(editedId);
    const current = selectedAsset();

    if (!original || !current) return false;

    return (
      original.name !== current.name ||
      original.version !== current.version ||
      original.type !== current.type ||
      original.category !== current.category ||
      original.description !== current.description
    );
  };

  const handleOpenInEditor = async (assetId: string) => {
    if (!defaultEditor()) {
      alert("Please configure a default editor in Settings first.");
      return;
    }

    try {
      // Get the file path for the edited asset
      const editedAsset = editedAssets().get(assetId);
      if (editedAsset) {
        await invoke("open_in_editor", {
          filePath: editedAsset.file_path,
          editorPath: defaultEditor(),
        });

        // Copy the file path to clipboard for easy export
        try {
          await navigator.clipboard.writeText(editedAsset.file_path);
          showMetadataSaveToast(`📋 Export path copied! Export GLB to this path when done editing.`, 5000);
        } catch (clipboardError) {
          // If clipboard fails, still show the path
          showMetadataSaveToast(`Export GLB to: ${editedAsset.file_path}`, 5000);
        }
      }
    } catch (error) {
      console.error("Failed to open in editor:", error);
      alert(`Failed to open in editor: ${error}`);
    }
  };

  const showMetadataSaveToast = (message: string, duration: number = 3000) => {
    setMetadataToastMessage(message);
    setShowMetadataToast(true);
    setTimeout(() => setShowMetadataToast(false), duration);
  };

  const handleSaveMetadata = async (assetId: string) => {
    try {
      const updatedAsset = selectedAsset();
      if (!updatedAsset) return;

      // Convert Asset to AssetMetadata format for backend
      const metadata = {
        id: updatedAsset.id,
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
      };
      await invoke("update_asset_metadata", { assetId, metadata });

      // Update the original metadata to reflect saved state
      setOriginalEditedMetadata(new Map(originalEditedMetadata().set(assetId, { ...updatedAsset })));
    } catch (error) {
      console.error("Failed to save metadata:", error);
      throw error;
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const handleOpenDownloadsFolder = async () => {
    try {
      const appDataPath = await invoke<string>("get_app_data_path");
      const cachePath = `${appDataPath}/cache`;
      await invoke("open_folder", { path: cachePath });
    } catch (error) {
      console.error("Failed to open downloads folder:", error);
    }
  };

  // Filter categories by selected type
  const filteredCategories = () => {
    if (!categories()) return [];
    if (selectedType() === "all") return categories();
    return categories().filter((cat: Category) => cat.type_id === selectedType());
  };

  return (
    <div class="asset-library">
      <div class="asset-library-header">
        <div class="search-bar">
          <div class="view-toggle">
            <button
              class={`view-btn ${viewMode() === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title="Grid view"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              class={`view-btn ${viewMode() === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
              title="List view"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>
          <input
            type="text"
            class="search-input"
            placeholder="Search assets..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSearch()}
          />
          <button class="header-btn" onClick={handleSearch}>
            Search
          </button>
          <button
            class={`filter-toggle-btn ${showFilters() ? "active" : ""}`}
            onClick={() => setShowFilters(!showFilters())}
            title="Toggle filters"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filters
          </button>
          <span class="page-info">
            {assets() && `${assets().length} assets`}
          </span>
        </div>
        {showFilters() && (
          <div class="filters-panel">
            <div class="control-group">
              <label>Sort:</label>
              <select
                class="select-input"
                value={sortBy()}
                onChange={(e) => setSortBy(e.currentTarget.value)}
              >
                <option value="recent">Recent</option>
                <option value="rating">Rating</option>
                <option value="name">Name</option>
                <option value="downloads">Downloads</option>
              </select>
            </div>
            <div class="control-group">
              <label>Type:</label>
              <select
                class="select-input"
                value={selectedType()}
                onChange={(e) => {
                  setSelectedType(e.currentTarget.value);
                  setSelectedCategory("all");
                }}
              >
                <option value="all">All</option>
                <option value="models">Models</option>
                <option value="environment">Environment</option>
              </select>
            </div>
            <div class="control-group">
              <label>Category:</label>
              <select
                class="select-input"
                value={selectedCategory()}
                onChange={(e) => setSelectedCategory(e.currentTarget.value)}
              >
                <option value="all">All</option>
                <For each={filteredCategories()}>
                  {(cat) => <option value={cat.id}>{cat.name}</option>}
                </For>
              </select>
            </div>
          </div>
        )}
      </div>

      <div class={`asset-grid ${viewMode() === "list" ? "list-view" : ""}`}>
        {assets.loading && <div class="loading">Loading assets...</div>}
        {assets.error && <div class="error">Failed to load assets. Make sure the asset service is running at {API_URL}</div>}
        {assets() && assets().length === 0 && !assets.loading && (
          <div class="empty">No assets found. Try running: poetry poe seed</div>
        )}
        <For each={assets()}>
          {(asset) => (
            <div class="asset-card" onClick={() => handleAssetClick(asset)}>
              <div class="asset-thumbnail">
                <div class="placeholder-icon">
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
              </div>
              <div class="asset-info">
                <div class="asset-header">
                  <div class="asset-name-wrapper">
                    <h3 class="asset-name">{asset.name}</h3>
                    {asset.required && <span class="required-badge">Essential</span>}
                  </div>
                  <button
                    class={`download-icon-btn ${cachedAssets().has(asset.id) ? "cached" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(asset.id, asset.name);
                    }}
                    disabled={downloading() === asset.id}
                    title={cachedAssets().has(asset.id) ? "Re-download" : "Download"}
                  >
                    {downloading() === asset.id ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
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
                    ) : cachedAssets().has(asset.id) ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    )}
                  </button>
                </div>
                {asset.description && (
                  <p class="asset-description">{asset.description}</p>
                )}
                <div class="asset-meta">
                  <span class="asset-type">{asset.type}</span>
                  <span class="asset-author">{asset.author}</span>
                </div>
                <div class="asset-rating">
                  <For each={[1, 2, 3, 4, 5]}>
                    {(star) => (
                      <svg
                        class={`star ${star <= asset.rating ? "filled" : ""}`}
                        xmlns="http://www.w3.org/2000/svg"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill={star <= asset.rating ? "currentColor" : "none"}
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    )}
                  </For>
                  {asset.rating_count > 0 && (
                    <span class="rating-count">({asset.rating_count})</span>
                  )}
                  <span class="asset-downloads">↓ {asset.downloads}</span>
                </div>
                <div class="asset-stats">
                  <span class="asset-license">{asset.license}</span>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>

      <div class="asset-pagination">
        <div class="status-bar-buttons">
          <button class="publish-btn" title="Publish to community">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 16.5c1.7 0 3-1.3 3-3s-1.3-3-3-3c-.4 0-.8.1-1.2.3-.6-2.3-2.7-4-5.2-4-2 0-3.8 1.1-4.7 2.8C7.6 9.2 6.4 10 5.5 11c-1.4.9-2.3 2.5-2.3 4.2 0 2.8 2.2 5 5 5h11.8"/>
              <polyline points="16 16 12 12 8 16"/>
              <line x1="12" y1="12" x2="12" y2="21"/>
            </svg>
            Publish
          </button>
          <div class="downloads-wrapper">
            <button
              class="downloads-btn"
              onClick={() => setIsDownloadsPanelOpen(!isDownloadsPanelOpen())}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Downloads</span>
              {downloadQueue().filter((d) => d.status === "downloading").length > 0 && (
                <span class="downloads-badge">
                  {downloadQueue().filter((d) => d.status === "downloading").length}
                </span>
              )}
            </button>
            {isDownloadsPanelOpen() && (
              <div class="downloads-popup downloads-popup-bottom">
                <div class="downloads-popup-header">
                  <h3>Downloads</h3>
                  <div class="downloads-header-buttons">
                    <button
                      class="open-folder-btn"
                      onClick={handleOpenDownloadsFolder}
                      title="Open downloads folder"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                    {downloadQueue().length > 0 && (
                      <button
                        class="clear-downloads-btn"
                        onClick={() =>
                          setDownloadQueue(
                            downloadQueue().filter((d) => d.status === "downloading")
                          )
                        }
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <div class="downloads-list">
                  {downloadQueue().length === 0 ? (
                    <div class="downloads-empty">No downloads</div>
                  ) : (
                    <For each={downloadQueue()}>
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
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                            {download.status === "failed" && (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                              >
                                <circle cx="12" cy="12" r="10" />
                                <line x1="15" y1="9" x2="9" y2="15" />
                                <line x1="9" y1="9" x2="15" y2="15" />
                              </svg>
                            )}
                          </div>
                          <div class="download-info">
                            <div class="download-name">{download.name}</div>
                            <div class="download-time">{formatTimeAgo(download.timestamp)}</div>
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

      {isPanelOpen() && selectedAsset() && (
        <div class="asset-detail-panel">
          <div class="panel-header">
            <div class="panel-title-wrapper">
              <h2>{selectedAsset()!.name}</h2>
              {selectedAsset()!.required && <span class="required-badge">Essential</span>}
              {editedAssets().has(selectedAsset()!.id) && (
                <span class="edited-badge">Edited</span>
              )}
            </div>
            <button class="close-btn" onClick={handleClosePanel}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="panel-content">
            <div class="panel-thumbnail">
              <div class="placeholder-icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="96"
                  height="96"
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
            </div>

            {editedAssets().has(selectedAsset()!.id) && (
              <div class="panel-section export-path-section">
                <div class="workflow-step">
                  <span class="step-number">1.</span>
                  <button
                    class={`edit-in-blender-btn ${!defaultEditor() ? "disabled" : ""}`}
                    onClick={() => {
                      if (defaultEditor()) {
                        handleOpenInEditor(selectedAsset()!.id);
                      }
                    }}
                    disabled={!defaultEditor()}
                    title={
                      !defaultEditor()
                        ? "Configure a default editor in Settings"
                        : `Open in ${getEditorDisplayName()}`
                    }
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Edit in {getEditorDisplayName()}
                  </button>
                </div>
                <div class="workflow-step">
                  <span class="step-number">2.</span>
                  <button
                    class="copy-path-btn-secondary"
                    onClick={async () => {
                      const editedAsset = editedAssets().get(selectedAsset()!.id);
                      if (editedAsset) {
                        try {
                          await navigator.clipboard.writeText(editedAsset.file_path);
                          showMetadataSaveToast("📋 Export path copied to clipboard!", 3000);
                        } catch (error) {
                          alert(`Path: ${editedAsset.file_path}`);
                        }
                      }
                    }}
                    title="Copy the file path where you need to export"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    Copy Path for Export
                  </button>
                </div>
                <div class="workflow-step">
                  <span class="step-number">3.</span>
                  <p class="path-hint">
                    In {getEditorDisplayName()}, export GLB to the copied path when done editing
                  </p>
                </div>
              </div>
            )}

            <div class="panel-section">
              <h3>Details</h3>
              <div class="detail-row">
                <span class="detail-label">Name:</span>
                {editedAssets().has(selectedAsset()!.id) ? (
                  <input
                    type="text"
                    class="detail-input"
                    value={selectedAsset()!.name}
                    onInput={(e) => {
                      const updated = { ...selectedAsset()!, name: e.currentTarget.value };
                      setSelectedAsset(updated);
                      // Note: Auto-save disabled for edited assets - use Save button
                    }}
                  />
                ) : (
                  <span class="detail-value">{selectedAsset()!.name}</span>
                )}
              </div>
              <div class="detail-row">
                <span class="detail-label">Author:</span>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem;">
                  <span class="detail-value">{selectedAsset()!.author}</span>
                  {editedAssets().has(selectedAsset()!.id) && (
                    <span class="detail-hint">
                      Change in <span class="settings-link">Edit → Settings</span>
                    </span>
                  )}
                </div>
              </div>
              <div class="detail-row">
                <span class="detail-label">Version:</span>
                {editedAssets().has(selectedAsset()!.id) ? (
                  <input
                    type="text"
                    class="detail-input"
                    value={selectedAsset()!.version}
                    placeholder="1.0.0"
                    pattern="^\d+\.\d+\.\d+$"
                    title="Version must be in semver format: MAJOR.MINOR.PATCH (e.g., 1.0.0)"
                    onInput={(e) => {
                      const value = e.currentTarget.value;
                      // Allow typing, but validate on blur
                      const updated = { ...selectedAsset()!, version: value };
                      setSelectedAsset(updated);
                    }}
                    onBlur={(e) => {
                      const value = e.currentTarget.value;
                      // Validate semver format: number.number.number
                      const semverRegex = /^\d+\.\d+\.\d+$/;
                      if (!semverRegex.test(value)) {
                        alert("Version must be in semver format: MAJOR.MINOR.PATCH (e.g., 1.0.0)");
                        // Reset to previous valid value or default
                        const original = originalEditedMetadata().get(selectedAsset()!.id);
                        if (original) {
                          setSelectedAsset({ ...selectedAsset()!, version: original.version });
                        }
                      }
                      // Note: Auto-save disabled for edited assets - use Save button
                    }}
                  />
                ) : (
                  <span class="detail-value">{selectedAsset()!.version}</span>
                )}
              </div>
              <div class="detail-row">
                <span class="detail-label">Type:</span>
                {editedAssets().has(selectedAsset()!.id) ? (
                  <input
                    type="text"
                    class="detail-input"
                    value={selectedAsset()!.type}
                    onInput={(e) => {
                      const updated = { ...selectedAsset()!, type: e.currentTarget.value };
                      setSelectedAsset(updated);
                      // Note: Auto-save disabled for edited assets - use Save button
                    }}
                  />
                ) : (
                  <span class="detail-value">{selectedAsset()!.type}</span>
                )}
              </div>
              <div class="detail-row">
                <span class="detail-label">Category:</span>
                {editedAssets().has(selectedAsset()!.id) ? (
                  <input
                    type="text"
                    class="detail-input"
                    value={selectedAsset()!.category}
                    onInput={(e) => {
                      const updated = { ...selectedAsset()!, category: e.currentTarget.value };
                      setSelectedAsset(updated);
                      // Note: Auto-save disabled for edited assets - use Save button
                    }}
                  />
                ) : (
                  <span class="detail-value">{selectedAsset()!.category}</span>
                )}
              </div>
              <div class="detail-row">
                <span class="detail-label">License:</span>
                <span class="detail-value">{selectedAsset()!.license}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Published:</span>
                <span class="detail-value">
                  {new Date(selectedAsset()!.publish_date).toLocaleDateString()}
                </span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Downloads:</span>
                <span class="detail-value">{selectedAsset()!.downloads}</span>
              </div>
              {selectedAsset()!.file_size && (
                <div class="detail-row">
                  <span class="detail-label">Size:</span>
                  <span class="detail-value">
                    {(selectedAsset()!.file_size! / 1024).toFixed(2)} KB
                  </span>
                </div>
              )}
            </div>

            <div class="panel-section">
              <h3>Description</h3>
              {editedAssets().has(selectedAsset()!.id) ? (
                <textarea
                  class="description-input"
                  value={selectedAsset()!.description || ""}
                  onInput={(e) => {
                    const updated = { ...selectedAsset()!, description: e.currentTarget.value };
                    setSelectedAsset(updated);
                    // Note: Auto-save disabled for edited assets - changes saved when you export GLB
                  }}
                  rows={4}
                  placeholder="Edit description (metadata only - GLB changes must be exported from Blender)"
                />
              ) : (
                selectedAsset()!.description && (
                  <p class="description-text">{selectedAsset()!.description}</p>
                )
              )}
            </div>

            {!editedAssets().has(selectedAsset()!.id) && (
              <div class="panel-section">
                <h3>Rating</h3>
                <div class="asset-rating">
                  <For each={[1, 2, 3, 4, 5]}>
                    {(star) => (
                      <svg
                        class={`star ${star <= selectedAsset()!.rating ? "filled" : ""}`}
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill={star <= selectedAsset()!.rating ? "currentColor" : "none"}
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    )}
                  </For>
                  {selectedAsset()!.rating_count > 0 && (
                    <span class="rating-count">({selectedAsset()!.rating_count} ratings)</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div class="panel-footer">
            {!editedAssets().has(selectedAsset()!.id) && (
              <button
                class={`download-btn-full ${cachedAssets().has(selectedAsset()!.id) ? "cached" : ""}`}
                onClick={() => handleDownload(selectedAsset()!.id, selectedAsset()!.name)}
                disabled={downloading() === selectedAsset()!.id}
              >
                {downloading() === selectedAsset()!.id
                  ? "Downloading..."
                  : cachedAssets().has(selectedAsset()!.id)
                    ? "Re-download Asset"
                    : "Download Asset"}
              </button>
            )}
            {cachedAssets().has(selectedAsset()!.id) && !selectedAsset()!.required && !editedAssets().has(selectedAsset()!.id) && (
              <button
                class="edit-btn"
                onClick={() => handleEditAsset(selectedAsset()!.id)}
                disabled={!isLicenseEditable(selectedAsset()!.license)}
                title={
                  !isLicenseEditable(selectedAsset()!.license)
                    ? "This asset's license does not permit modifications"
                    : "Create editable copy"
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
            )}
            {editedAssets().has(selectedAsset()!.id) && (
              <button
                class={hasMetadataChanges(selectedAsset()!.id) ? "save-metadata-btn" : "revert-btn"}
                onClick={async () => {
                  if (hasMetadataChanges(selectedAsset()!.id)) {
                    // Save the metadata changes
                    await handleSaveMetadata(selectedAsset()!.id);
                    showMetadataSaveToast("Metadata saved", 2000);
                  } else {
                    // Just cancel/close
                    handleRevertToOriginal(selectedAsset()!.id);
                  }
                }}
                title={
                  hasMetadataChanges(selectedAsset()!.id)
                    ? "Save metadata changes"
                    : "Cancel editing"
                }
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  {hasMetadataChanges(selectedAsset()!.id) ? (
                    <>
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </>
                  ) : (
                    <>
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </>
                  )}
                </svg>
                {hasMetadataChanges(selectedAsset()!.id) ? "Save" : "Cancel"}
              </button>
            )}
            {cachedAssets().has(selectedAsset()!.id) && !selectedAsset()!.required && !editedAssets().has(selectedAsset()!.id) && (
              <button
                class="delete-cached-btn"
                onClick={() => handleDeleteCachedAsset(selectedAsset()!.id, selectedAsset()!.name)}
                title="Delete from cache"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                Delete from Cache
              </button>
            )}
          </div>
        </div>
      )}

      {showMetadataToast() && (
        <div class="settings-toast">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          <span>{metadataToastMessage()}</span>
        </div>
      )}
    </div>
  );
};

export default AssetLibrary;
