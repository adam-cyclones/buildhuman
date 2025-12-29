import { createSignal, For, onMount, createResource, createEffect, on } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readFile } from "@tauri-apps/plugin-fs";
import { config } from "../../config";
import AssetGrid from "./components/AssetGrid";
import AssetFilters from "./components/AssetFilters";
import AssetDetailPanel from "./components/AssetDetailPanel";
import { useAssetEvents } from "./components/useAssetEvents";
import { useAssetEditing } from "../../machines/useAssetEditing";
import { useAssetPublishing } from "../../machines/useAssetPublishing";
import Icon from "../../components/Icon";
import type { Asset, LocalAsset, Category, Download, Submission, AssetLibraryProps, AssetMachines } from "./types";
import "./AssetLibrary.css";

const API_URL = config.apiUrl;

const AssetLibrary = (props: AssetLibraryProps) => {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [sortBy, setSortBy] = createSignal("recent");
  const [selectedType, setSelectedType] = createSignal("all");
  const [selectedCategory, setSelectedCategory] = createSignal("all");
  const [downloading, setDownloading] = createSignal<string | null>(null);
  const [selectedAsset, setSelectedAsset] = createSignal<Asset | null>(null);
  const [isPanelOpen, setIsPanelOpen] = createSignal(false);
  const [downloadQueue, setDownloadQueue] = createSignal<Download[]>([]);
  const [isDownloadsPanelOpen, setIsDownloadsPanelOpen] = createSignal(false);
  const [viewMode, setViewMode] = createSignal<string>("grid");
  const [cachedAssets, setCachedAssets] = createSignal<Set<string>>(new Set());
  const [editedAssets, setEditedAssets] = createSignal<Map<string, LocalAsset>>(new Map());
  const [showMetadataToast, setShowMetadataToast] = createSignal(false);
  const [metadataToastMessage, setMetadataToastMessage] = createSignal("");
  const [originalEditedMetadata, setOriginalEditedMetadata] = createSignal<Map<string, Asset>>(new Map());
  const [changedAssetId, setChangedAssetId] = createSignal<string | null>(null);
  const [appDataPath, setAppDataPath] = createSignal<string>("");
  const [thumbnailTimestamps, setThumbnailTimestamps] = createSignal<Map<string, number>>(new Map());
  const [pendingSubmissions, setPendingSubmissions] = createSignal<Submission[]>([]);
  const [reviewAction, setReviewAction] = createSignal<"approve" | "reject" | null>(null);
  const [rejectionReason, setRejectionReason] = createSignal("");
  const [reviewNotes, setReviewNotes] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  // XState machines for each edited asset
  const [assetMachines, setAssetMachines] = createSignal<Map<string, AssetMachines>>(new Map());

  // Initialize or get machine for an asset
  const getMachine = (assetId: string, metadata?: any): AssetMachines => {
    let machines = assetMachines().get(assetId);
    if (!machines) {
      // Initialize machines from metadata if available
      machines = {
        editing: useAssetEditing({
          assetId,
          hasUnsavedChanges: false,
          changes: { metadata: false, file: false, thumbnail: false }
        }),
        publishing: useAssetPublishing({
          assetId,
          assetName: metadata?.name || "",
          submissionId: metadata?.submission_id,
          editedAfterSubmit: metadata?.last_edited_after_publish || false
        })
      };

      setAssetMachines(prev => {
        const newMap = new Map(prev);
        newMap.set(assetId, machines!);
        return newMap;
      });

      // Move machine to correct state based on metadata
      if (metadata?.submission_status === "pending") {
        // Transition to pending state
        machines.publishing.send({ type: "SUBMIT" });
        machines.publishing.send({ type: "SUBMIT_SUCCESS", submissionId: metadata.submission_id });

        // If edited after publish, transition to pendingWithEdits
        if (metadata.last_edited_after_publish) {
          machines.publishing.send({ type: "EDIT" });
        }
      }
    }
    return machines;
  };

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

  // Fetch pending submissions (for moderators)
  const fetchPendingSubmissions = async () => {
    if (!props.appSettings?.moderator_mode || !props.appSettings?.moderator_api_key) {
      return [];
    }

    try {
      const response = await fetch(`${API_URL}/api/submissions/pending`, {
        headers: {
          "X-API-Key": props.appSettings.moderator_api_key
        }
      });

      if (!response.ok) {
        throw new Error("Failed to fetch pending submissions");
      }

      const submissions = await response.json();
      setPendingSubmissions(submissions);
      return submissions;
    } catch (error) {
      console.error("Failed to fetch pending submissions:", error);
      return [];
    }
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

  // Fetch pending submissions when type changes to "pending"
  createEffect(
    on(
      selectedType,
      (type) => {
        if (type === "pending") {
          fetchPendingSubmissions();
        }
      }
    )
  );

  // Refetch when filters change
  const handleSearch = () => {
    refetch();
  };

  // Merge API assets with local edited assets
  const allAssets = () => {
    // If viewing pending submissions, return those instead
    if (selectedType() === "pending") {
      return pendingSubmissions().map(submission => ({
        id: submission.id,
        name: submission.asset_name,
        description: submission.asset_description,
        type: submission.asset_type,
        category: submission.asset_category,
        author: submission.author,
        rating: 0,
        rating_count: 0,
        license: submission.license,
        publish_date: submission.submitted_at,
        downloads: 0,
        file_size: submission.file_size,
        version: submission.version,
        required: false,
        thumbnail_url: submission.thumbnail_path
      } as Asset));
    }

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
    // Get app data path for converting local file paths
    try {
      const path = await invoke<string>("get_app_data_path");
      setAppDataPath(path);
    } catch (error) {
      console.error("Failed to get app data path:", error);
    }

    // Load thumbnail timestamps from localStorage
    try {
      const stored = localStorage.getItem("thumbnailTimestamps");
      if (stored) {
        const parsed = JSON.parse(stored);
        setThumbnailTimestamps(new Map(Object.entries(parsed).map(([k, v]) => [k, v as number])));
      }
    } catch (error) {
      console.error("Failed to load thumbnail timestamps:", error);
    }

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
          ...(existingEdited.metadata as Asset),
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

  // Event logging system for undo/redo and activity tracking
  const { logEvent, getRecentEvents } = useAssetEvents(editedAssets, setEditedAssets);

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

        // Log fork event
        await logEvent(newCopy.metadata.id, "forked", {
          original_id: originalId,
          original_name: asset?.name || "original asset"
        });
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

  const convertToAssetPath = (thumbnailUrl: string, bustCache = false) => {
    if (thumbnailUrl.startsWith('http')) {
      return thumbnailUrl; // External URL
    }
    // Convert local filename to Tauri asset protocol URL
    if (!appDataPath()) {
      return ''; // App data path not loaded yet
    }
    const fullPath = `${appDataPath()}/created-assets/${thumbnailUrl}`;
    const url = convertFileSrc(fullPath);
    // Add cache-busting timestamp if needed
    return bustCache ? `${url}?t=${Date.now()}` : url;
  };

  const handleSaveMetadata = async (assetId: string) => {
    // Get or create machine for this asset
    let machines = getMachine(assetId);

    // Send SAVE event to editing machine
    machines.editing.send({ type: "SAVE" });

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

        // Get new machine for the real asset ID
        machines = getMachine(assetId, editedAsset.metadata);
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

      // Check publishing machine state instead of manual flag
      const isPending = machines.publishing.isPending();
      if (isPending) {
        // Notify publishing machine that asset was edited while pending
        machines.publishing.send({ type: "EDIT" });
        metadata.last_edited_after_publish = true;

        // Update local state
        setEditedAssets(prev => {
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
      await logEvent(assetId, isPending ? "edited_after_publish" : "metadata_saved", {
        fields: Object.keys(metadata).filter(k => k !== 'id')
      });

      // Update the original metadata to reflect saved state
      setOriginalEditedMetadata(new Map(originalEditedMetadata().set(assetId, { ...updatedAsset })));
    } catch (error) {
      console.error("Failed to save metadata:", error);

      // Send SAVE_FAILURE to editing machine
      machines.editing.send({ type: "SAVE_FAILURE", error: String(error) });

      throw error;
    }
  };

  const handleChangeThumbnail = async (assetId: string) => {
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
        // Call backend to set the thumbnail
        await invoke("set_asset_thumbnail", {
          assetId,
          thumbnailPath: selected
        });

        // The backend will return a relative path or filename
        const thumbnailFilename = await invoke<string>("get_asset_thumbnail", { assetId });

        // Update the selected asset to show the new thumbnail
        const updatedAsset = { ...selectedAsset()! };
        updatedAsset.thumbnail_url = thumbnailFilename;
        setSelectedAsset(updatedAsset);

        // Also update the editedAssets map to persist the change
        if (editedAssets().has(assetId)) {
          setEditedAssets(prev => {
            const newMap = new Map(prev);
            const asset = newMap.get(assetId);
            if (asset) {
              // Create new asset object to trigger reactivity
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
        setThumbnailTimestamps(prev => {
          const newMap = new Map(prev);
          newMap.set(assetId, Date.now());
          // Save to localStorage for persistence
          localStorage.setItem("thumbnailTimestamps", JSON.stringify(Object.fromEntries(newMap)));
          return newMap;
        });

        showMetadataSaveToast("Thumbnail updated", 2000);

        // Log thumbnail change event
        await logEvent(assetId, "thumbnail_changed", {
          filename: thumbnailFilename
        });
      }
    } catch (error) {
      console.error("Failed to set thumbnail:", error);
      showMetadataSaveToast(`Failed to set thumbnail: ${error}`, 3000);
    }
  };

  const handlePublishAsset = async (assetId: string) => {
    const asset = editedAssets().get(assetId);
    if (!asset) {
      alert("Asset not found");
      return;
    }

    // Get or create machine for this asset
    const machines = getMachine(assetId, asset.metadata);

    // Send SUBMIT event to publishing machine (starts the submission process)
    machines.publishing.send({ type: "SUBMIT" });

    try {
      // Create FormData for multipart upload
      const formData = new FormData();

      // Read the GLB file using Tauri FS
      const glbBytes = await readFile(asset.file_path);
      const glbBlob = new Blob([glbBytes], { type: "model/gltf-binary" });
      formData.append("file", glbBlob, `${asset.metadata.name}.glb`);

      // Read thumbnail if exists
      if (asset.metadata.thumbnail_url) {
        const thumbnailPath = `${appDataPath()}/created-assets/${asset.metadata.thumbnail_url}`;
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

      // Send metadata as JSON string
      formData.append("metadata", JSON.stringify(metadata));

      // Submit to service
      const response = await fetch(`${API_URL}/api/submissions`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        throw new Error("Failed to submit asset");
      }

      const result = await response.json();

      // Send SUBMIT_SUCCESS to publishing machine
      machines.publishing.send({
        type: "SUBMIT_SUCCESS",
        submissionId: result.id
      });

      // Update asset metadata to track submission
      const updatedAssets = new Map(editedAssets());
      const updatedAsset = updatedAssets.get(assetId);
      if (updatedAsset) {
        updatedAsset.metadata.submission_id = result.id;
        updatedAsset.metadata.submission_status = "pending";
        updatedAsset.metadata.last_edited_after_publish = false; // Reset flag on fresh submission
        setEditedAssets(updatedAssets);

        // Persist submission status to backend
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

      // Log publish event
      await logEvent(assetId, "published", {
        submission_id: result.id,
        asset_name: asset.metadata.name
      });

      // Show success toast
      showMetadataSaveToast("Asset submitted successfully! Pending review.", 5000);

    } catch (error) {
      console.error("Failed to publish asset:", error);

      // Send SUBMIT_FAILURE to publishing machine
      machines.publishing.send({
        type: "SUBMIT_FAILURE",
        error: String(error)
      });

      showMetadataSaveToast(`Failed to publish: ${error}`, 5000);
    }
  };

  const handleReview = async (submissionId: string) => {
    const action = reviewAction();

    if (!action) return;
    if (!props.appSettings?.moderator_api_key) {
      alert("API key not configured. Please set it in Settings.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(
        `${API_URL}/api/submissions/${submissionId}/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": props.appSettings.moderator_api_key
          },
          body: JSON.stringify({
            action,
            notes: reviewNotes(),
            rejection_reason: action === "reject" ? rejectionReason() : undefined
          })
        }
      );

      if (!response.ok) {
        throw new Error("Failed to submit review");
      }

      showMetadataSaveToast(
        `Submission ${action === "approve" ? "approved" : "rejected"} successfully!`,
        4000
      );

      // Reset form
      setReviewAction(null);
      setRejectionReason("");
      setReviewNotes("");
      setIsPanelOpen(false);

      // Refetch pending submissions
      await fetchPendingSubmissions();

    } catch (error) {
      console.error("Review failed:", error);
      showMetadataSaveToast(`Failed to submit review: ${error}`, 5000);
    } finally {
      setSubmitting(false);
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
            <Icon name="eye" size={20} />
            <span>
              Asset "{editedAssets().get(changedAssetId()!)?.metadata.name || changedAssetId()}" has been updated externally.
            </span>
          </div>
          <div class="banner-actions">
            <button class="reload-btn" onClick={handleReloadChangedAsset}>
              <Icon name="reload" size={16} />
              Reload
            </button>
            <button class="dismiss-btn" onClick={() => setChangedAssetId(null)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>
      )}

      <AssetFilters
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        sortBy={sortBy}
        setSortBy={setSortBy}
        selectedType={selectedType}
        setSelectedType={setSelectedType}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        filteredCategories={filteredCategories}
        assetCount={assets()?.length || 0}
        onSearch={handleSearch}
        showModeratorOptions={props.appSettings?.moderator_mode && !!props.appSettings?.moderator_api_key}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />

      <AssetGrid
        assets={allAssets}
        loading={assets.loading}
        error={assets.error}
        viewMode={viewMode}
        selectedType={selectedType}
        apiUrl={API_URL}
        onAssetClick={handleAssetClick}
        convertToAssetPath={convertToAssetPath}
        thumbnailTimestamps={thumbnailTimestamps}
        cachedAssets={cachedAssets}
        downloading={downloading}
        onDownload={handleDownload}
        editedAssets={editedAssets}
        allAssets={() => assets() || []}
      />

      <div class="asset-pagination">
        <div class="status-bar-buttons">
          <button class="publish-btn" title="Publish to community">
            <Icon name="upload" size={16} />
            Publish
          </button>
          <div class="downloads-wrapper">
            <button
              class="downloads-btn"
              onClick={() => setIsDownloadsPanelOpen(!isDownloadsPanelOpen())}
            >
              <Icon name="download" size={16} />
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
                      <Icon name="folder" size={14} />
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
                              <Icon name="check" size={16} />
                            )}
                            {download.status === "failed" && (
                              <Icon name="x-circle" size={16} />
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
        <AssetDetailPanel
          selectedAsset={selectedAsset}
          setSelectedAsset={setSelectedAsset}
          isEditingAsset={isEditingAsset}
          editedAssets={editedAssets}
          cachedAssets={cachedAssets}
          getMachine={getMachine}
          originalEditedMetadata={originalEditedMetadata}
          convertToAssetPath={convertToAssetPath}
          thumbnailTimestamps={thumbnailTimestamps}
          getRecentEvents={getRecentEvents}
          selectedType={selectedType}
          downloading={downloading}
          reviewAction={reviewAction}
          setReviewAction={setReviewAction}
          rejectionReason={rejectionReason}
          setRejectionReason={setRejectionReason}
          reviewNotes={reviewNotes}
          setReviewNotes={setReviewNotes}
          submitting={submitting}
          appSettings={props.appSettings}
          onClose={handleClosePanel}
          onChangeThumbnail={handleChangeThumbnail}
          onOpenInBlender={handleOpenInBlender}
          onSaveMetadata={handleSaveMetadata}
          onPublishAsset={handlePublishAsset}
          onDeleteCached={handleDeleteCachedAsset}
          onRevertToOriginal={handleRevertToOriginal}
          onReview={handleReview}
          onDownload={handleDownload}
          onEditAsset={handleEditAsset}
          isLicenseEditable={isLicenseEditable}
          showMetadataSaveToast={showMetadataSaveToast}
        />
      )}

      {showMetadataToast() && (
        <div class="settings-toast">
          <Icon name="check" size={16} />
          <span>{metadataToastMessage()}</span>
        </div>
      )}
    </div>
  );
};

export default AssetLibrary;
