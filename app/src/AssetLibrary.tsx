import { createSignal, For, onMount, createResource, createEffect, on } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  thumbnail_url?: string;
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
  const [originalEditedMetadata, setOriginalEditedMetadata] = createSignal<Map<string, Asset>>(new Map());
  const [changedAssetId, setChangedAssetId] = createSignal<string | null>(null);
  const [selectedVersions, setSelectedVersions] = createSignal<Map<string, 'original' | 'edited'>>(new Map());

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

  // Merge API assets with local edited assets
  const allAssets = () => {
    const apiAssets = assets() || [];
    const localAssets = Array.from(editedAssets().values()).map(local => local.metadata);

    // Combine both
    const combined = [...apiAssets, ...localAssets];

    // Sort so forks appear right after their parent
    combined.sort((a, b) => {
      // Extract base ID (without _edited_ suffix and timestamp)
      const getBaseId = (id: string) => id.split("_edited_")[0];
      const baseA = getBaseId(a.id);
      const baseB = getBaseId(b.id);

      // If they share the same base ID, parent comes first
      if (baseA === baseB) {
        return a.id.includes("_edited_") ? 1 : -1;
      }

      // Otherwise, sort by base ID
      return baseA.localeCompare(baseB);
    });

    return combined;
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
      console.log("📦 Loaded cached assets:", cached);

      const assetIds = cached.map(asset => asset.metadata.id);
      setCachedAssets(new Set(assetIds));

      // Also populate edited assets map
      const edited = cached.filter(asset =>
        asset.is_edited || asset.metadata.id.endsWith("_editing") || asset.metadata.id.includes("_edited_")
      );

      console.log("✏️ Edited assets found:", edited);

      setEditedAssets(prev => {
        const newMap = new Map(prev);
        edited.forEach(asset => {
          newMap.set(asset.metadata.id, asset);
        });
        return newMap;
      });
    } catch (error) {
      console.error("Failed to fetch cached assets:", error);
    }
  };

  onMount(async () => {
    // Fetch cached assets
    fetchCachedAssets();

    // Listen for asset file changes from Tauri
    const unlisten = await listen<string>("asset-file-changed", (event) => {
      console.log("Asset file changed:", event.payload);
      const assetId = event.payload;

      // Show notification
      setChangedAssetId(assetId);

      // Auto-hide notification after 10 seconds
      setTimeout(() => {
        if (changedAssetId() === assetId) {
          setChangedAssetId(null);
        }
      }, 10000);
    });

    // Return cleanup function
    return () => {
      unlisten();
    };
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
    // Just switch to editing mode - don't create files yet
    // Files will be created when user clicks "Edit in Blender" or "Save"

    const asset = selectedAsset();
    if (!asset) return;

    // Check if there's already a saved edited version
    const existingEdited = editedAssets().get(assetId + "_editing");

    // Create a temporary edited asset (no files created yet)
    // If an edited version already exists, use that as the base
    const editedAsset: Asset = existingEdited
      ? {
          ...existingEdited.metadata,
          id: assetId + "_editing",
        }
      : {
          ...asset,
          id: assetId + "_editing", // Temporary ID to track editing mode
        };

    setSelectedAsset(editedAsset);

    // Store the original for later copy creation (only if not already stored)
    if (!existingEdited) {
      setOriginalEditedMetadata(prev => {
        const newMap = new Map(prev);
        newMap.set(editedAsset.id, { ...asset });
        return newMap;
      });
    }
  };

  const handleRevertToOriginal = async (editedId: string) => {
    // Check if we actually created files or just in "_editing" mode
    const hasRealCopy = editedAssets().has(editedId);

    if (hasRealCopy) {
      // Files were created - need to delete them
      if (hasMetadataChanges(editedId)) {
        if (!confirm("Revert to original? This will discard your changes and delete the edited files.")) {
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
    } else {
      // Just in "_editing" mode - no files created, just close
      console.log("Canceling edit mode - no files to delete");

      // Remove from original metadata map
      setOriginalEditedMetadata(prev => {
        const newMap = new Map(prev);
        newMap.delete(editedId);
        return newMap;
      });

      setIsPanelOpen(false);
    }
  };

  const isEditingAsset = (assetId: string) => {
    // Check if asset is in editing mode (either has real copy or is in "_editing" mode)
    return editedAssets().has(assetId) || assetId.endsWith("_editing");
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

  const hasEditedVersion = (assetId: string) => {
    return editedAssets().has(assetId + "_editing");
  };

  const getDisplayAsset = (asset: Asset): Asset => {
    const editedVersionId = asset.id + "_editing";
    const selectedVersion = selectedVersions().get(asset.id) || 'original';

    if (selectedVersion === 'edited' && editedAssets().has(editedVersionId)) {
      return editedAssets().get(editedVersionId)!.metadata;
    }
    return asset;
  };

  const toggleVersion = (assetId: string, e: MouseEvent) => {
    e.stopPropagation();
    const current = selectedVersions().get(assetId) || 'original';
    const newVersion = current === 'original' ? 'edited' : 'original';

    setSelectedVersions(prev => {
      const newMap = new Map(prev);
      newMap.set(assetId, newVersion);
      return newMap;
    });
  };

  const handleOpenInBlender = async (assetId: string) => {
    try {
      // Create editable copy if it doesn't exist yet
      let editedAsset = editedAssets().get(assetId);

      if (!editedAsset) {
        // Extract original asset ID (remove "_editing" suffix if present)
        const originalId = assetId.replace("_editing", "");

        console.log("Creating editable copy for:", originalId);
        const newCopy = await invoke<LocalAsset>("create_editable_copy", { assetId: originalId });

        // Add to edited assets map
        setEditedAssets(prev => {
          const newMap = new Map(prev);
          newMap.set(newCopy.metadata.id, newCopy);
          return newMap;
        });

        // Update selected asset to use the real edited ID
        const asset = selectedAsset();
        if (asset) {
          const realEditedAsset: Asset = {
            ...asset,
            id: newCopy.metadata.id,
            name: newCopy.metadata.name,
            author: newCopy.metadata.author,
          };
          setSelectedAsset(realEditedAsset);
        }

        editedAsset = newCopy;
      }

      if (editedAsset) {
        await invoke("open_in_blender", {
          filePath: editedAsset.file_path,
          assetId: editedAsset.metadata.id,
        });

        // Show success message with auto-export info
        showMetadataSaveToast(`✨ Opening in Blender... Auto-export enabled! Just press Ctrl+S to save.`, 5000);
      }
    } catch (error) {
      console.error("Failed to open in Blender:", error);
      alert(`Failed to open in Blender: ${error}`);
    }
  };

  const showMetadataSaveToast = (message: string, duration: number = 3000) => {
    setMetadataToastMessage(message);
    setShowMetadataToast(true);
    setTimeout(() => setShowMetadataToast(false), duration);
  };

  const convertToAssetPath = (thumbnailUrl: string) => {
    if (thumbnailUrl.startsWith('http')) {
      return thumbnailUrl; // External URL
    }
    // Convert local filename to file:// URL using the created-assets directory
    const homeDir = '~/.buildhuman'; // Will be resolved by Tauri
    return `file://${homeDir}/created-assets/${thumbnailUrl}`;
  };

  const handleCaptureScreenshot = async (assetId: string) => {
    try {
      const editedAsset = editedAssets().get(assetId);
      if (!editedAsset) {
        alert("Asset not found");
        return;
      }

      showMetadataSaveToast("Capturing screenshot...", 30000); // Long timeout for Blender render

      // Call backend to capture screenshot
      const thumbnailPath = await invoke<string>("capture_asset_screenshot", {
        assetId: editedAsset.metadata.id,
        glbPath: editedAsset.file_path
      });

      // Update metadata with new thumbnail
      const updatedMetadata = {
        ...editedAsset.metadata,
        thumbnail_url: thumbnailPath
      };

      await invoke("update_asset_metadata", {
        assetId: editedAsset.metadata.id,
        metadata: updatedMetadata
      });

      // Refresh UI
      await fetchCachedAssets();
      showMetadataSaveToast("Screenshot captured!", 2000);
    } catch (error) {
      console.error("Failed to capture screenshot:", error);
      showMetadataSaveToast(`Screenshot failed: ${error}`, 3000);
    }
  };

  const handleSaveMetadata = async (assetId: string) => {
    try {
      const updatedAsset = selectedAsset();
      if (!updatedAsset) return;

      // Create editable copy if it doesn't exist yet
      let editedAsset = editedAssets().get(assetId);

      if (!editedAsset) {
        // Extract original asset ID (remove "_editing" suffix if present)
        const originalId = assetId.replace("_editing", "");

        console.log("Creating editable copy for save:", originalId);
        const newCopy = await invoke<LocalAsset>("create_editable_copy", { assetId: originalId });

        // Add to edited assets map
        setEditedAssets(prev => {
          const newMap = new Map(prev);
          newMap.set(newCopy.metadata.id, newCopy);
          return newMap;
        });

        // Update selected asset to use the real edited ID
        const realEditedAsset: Asset = {
          ...updatedAsset,
          id: newCopy.metadata.id,
        };
        setSelectedAsset(realEditedAsset);

        editedAsset = newCopy;
        assetId = newCopy.metadata.id; // Use real ID for saving
      }

      // Convert Asset to AssetMetadata format for backend
      const metadata = {
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

  const handleReloadChangedAsset = () => {
    const assetId = changedAssetId();
    if (!assetId) return;

    // Dismiss the notification
    setChangedAssetId(null);

    // Refresh the view if the asset detail panel is open
    if (selectedAsset() && selectedAsset()!.id === assetId) {
      // Close and reopen the panel to refresh
      setIsPanelOpen(false);
      setTimeout(() => {
        const asset = assets()?.find((a: Asset) => a.id === assetId);
        if (asset) {
          setSelectedAsset(asset);
          setIsPanelOpen(true);
        }
      }, 100);
    }

    showMetadataSaveToast("✨ Asset reloaded from disk", 2000);
  };

  // Filter categories by selected type
  const filteredCategories = () => {
    if (!categories()) return [];
    if (selectedType() === "all") return categories();
    return categories().filter((cat: Category) => cat.type_id === selectedType());
  };

  return (
    <div class="asset-library">
      {changedAssetId() && (
        <div class="asset-changed-banner">
          <div class="banner-content">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>
              Asset "{editedAssets().get(changedAssetId()!)?.metadata.name || changedAssetId()}" has been updated externally.
            </span>
          </div>
          <div class="banner-actions">
            <button class="reload-btn" onClick={handleReloadChangedAsset}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Reload
            </button>
            <button class="dismiss-btn" onClick={() => setChangedAssetId(null)}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
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
        </div>
      )}
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
        {allAssets().length === 0 && !assets.loading && (
          <div class="empty">No assets found. Try running: poetry poe seed</div>
        )}
        <For each={allAssets()}>
          {(asset) => (
            <div class="asset-card" onClick={() => handleAssetClick(asset)}>
              <div class="asset-thumbnail">
                {asset.thumbnail_url ? (
                  <img
                    src={convertToAssetPath(asset.thumbnail_url)}
                    alt={asset.name}
                    class="asset-thumbnail-image"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
                <div class={`placeholder-icon ${asset.thumbnail_url ? 'hidden' : ''}`}>
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
                    {asset.id.includes("_edited_") && (() => {
                      const originalId = asset.id.split("_edited_")[0];
                      const originalAsset = assets()?.find((a: Asset) => a.id === originalId);
                      return (
                        <span
                          class="forked-badge"
                          title={`Forked from "${originalAsset?.name || originalId}" - click to view original`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (originalAsset) {
                              handleAssetClick(originalAsset);
                            }
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <circle cx="12" cy="18" r="3" />
                            <circle cx="6" cy="6" r="3" />
                            <circle cx="18" cy="6" r="3" />
                            <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
                            <path d="M12 12v3" />
                          </svg>
                          Forked
                        </span>
                      );
                    })()}
                  </div>
                  <button
                    class={`download-icon-btn ${cachedAssets().has(asset.id) ? "cached" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(asset.id, asset.name);
                    }}
                    disabled={downloading() === asset.id || cachedAssets().has(asset.id)}
                    title={cachedAssets().has(asset.id) ? "Downloaded" : "Download"}
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
              {isEditingAsset(selectedAsset()!.id) && (
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
            <div class="panel-thumbnail-container">
              <div class="panel-thumbnail">
                {selectedAsset()!.thumbnail_url ? (
                  <img
                    src={convertToAssetPath(selectedAsset()!.thumbnail_url)}
                    alt={selectedAsset()!.name}
                    class="panel-thumbnail-image"
                    onError={(e) => e.currentTarget.style.display = 'none'}
                  />
                ) : null}
                <div class={`placeholder-icon ${selectedAsset()!.thumbnail_url ? 'hidden' : ''}`}>
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
              {isEditingAsset(selectedAsset()!.id) && (
                <div class="thumbnail-actions">
                  <button
                    class="thumbnail-action-btn"
                    onClick={() => handleCaptureScreenshot(selectedAsset()!.id)}
                    title="Capture screenshot using Blender"
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
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                    Screenshot
                  </button>
                  <button
                    class="thumbnail-action-btn"
                    onClick={() => {/* TODO: Upload image */}}
                    title="Upload custom thumbnail image"
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
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Upload
                  </button>
                </div>
              )}
            </div>

            {isEditingAsset(selectedAsset()!.id) && (
              <div class="panel-section export-path-section">
                <div class="workflow-instructions">
                  <h4>Seamless Blender Workflow</h4>
                  <ol class="workflow-list">
                    <li>Click "Edit in Blender" to open the asset</li>
                    <li>Make your changes in Blender</li>
                    <li>Press Ctrl+S to save - the GLB auto-exports!</li>
                    <li>BuildHuman will detect changes and show a notification</li>
                  </ol>
                  <button
                    class="edit-in-blender-btn"
                    onClick={() => handleOpenInBlender(selectedAsset()!.id)}
                    title="Open in Blender with auto-export"
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
                    Edit in Blender
                  </button>
                </div>
              </div>
            )}

            <div class="panel-section">
              <h3>Details</h3>
              <div class="detail-row">
                <span class="detail-label">Name:</span>
                {isEditingAsset(selectedAsset()!.id) ? (
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
                  {isEditingAsset(selectedAsset()!.id) && (
                    <span class="detail-hint">
                      Change in <span class="settings-link">Edit → Settings</span>
                    </span>
                  )}
                </div>
              </div>
              <div class="detail-row">
                <span class="detail-label">Version:</span>
                {isEditingAsset(selectedAsset()!.id) ? (
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
                {isEditingAsset(selectedAsset()!.id) ? (
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
                {isEditingAsset(selectedAsset()!.id) ? (
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
              {isEditingAsset(selectedAsset()!.id) ? (
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

            {!isEditingAsset(selectedAsset()!.id) && (
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
            {!isEditingAsset(selectedAsset()!.id) && !cachedAssets().has(selectedAsset()!.id) && (
              <button
                class="download-btn-full"
                onClick={() => handleDownload(selectedAsset()!.id, selectedAsset()!.name)}
                disabled={downloading() === selectedAsset()!.id}
              >
                {downloading() === selectedAsset()!.id
                  ? "Downloading..."
                  : "Download Asset"}
              </button>
            )}
            {cachedAssets().has(selectedAsset()!.id) && !selectedAsset()!.required && !isEditingAsset(selectedAsset()!.id) && (
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
            {isEditingAsset(selectedAsset()!.id) && (
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
                    : "Close panel"
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
                {hasMetadataChanges(selectedAsset()!.id) ? "Save" : "Close"}
              </button>
            )}
            {cachedAssets().has(selectedAsset()!.id) && !selectedAsset()!.required && !isEditingAsset(selectedAsset()!.id) && (
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
                Delete from Downloads
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
