/**
 * Custom hook to manage all AssetLibrary state
 * Consolidates all createSignal declarations
 */

import { createSignal, Accessor, Setter } from "solid-js";
import type { Asset, LocalAsset, Download, Submission } from "../types";

export interface AssetLibraryState {
  // Search and filters
  searchQuery: Accessor<string>;
  setSearchQuery: Setter<string>;
  sortBy: Accessor<string>;
  setSortBy: Setter<string>;
  selectedType: Accessor<string>;
  setSelectedType: Setter<string>;
  selectedCategory: Accessor<string>;
  setSelectedCategory: Setter<string>;

  // Download state
  downloading: Accessor<string | null>;
  setDownloading: Setter<string | null>;
  downloadQueue: Accessor<Download[]>;
  setDownloadQueue: Setter<Download[]>;
  isDownloadsPanelOpen: Accessor<boolean>;
  setIsDownloadsPanelOpen: Setter<boolean>;

  // Asset selection and panel
  selectedAsset: Accessor<Asset | null>;
  setSelectedAsset: Setter<Asset | null>;
  isPanelOpen: Accessor<boolean>;
  setIsPanelOpen: Setter<boolean>;

  // View mode
  viewMode: Accessor<string>;
  setViewMode: Setter<string>;

  // Asset caching and editing
  cachedAssets: Accessor<Set<string>>;
  setCachedAssets: Setter<Set<string>>;
  editedAssets: Accessor<Map<string, LocalAsset>>;
  setEditedAssets: Setter<Map<string, LocalAsset>>;
  originalEditedMetadata: Accessor<Map<string, Asset>>;
  setOriginalEditedMetadata: Setter<Map<string, Asset>>;
  editingAssetIds: Accessor<Set<string>>;
  setEditingAssetIds: Setter<Set<string>>;

  // Asset file changes
  changedAssetId: Accessor<string | null>;
  setChangedAssetId: Setter<string | null>;

  // App data
  appDataPath: Accessor<string>;
  setAppDataPath: Setter<string>;

  // Thumbnails
  thumbnailTimestamps: Accessor<Map<string, number>>;
  setThumbnailTimestamps: Setter<Map<string, number>>;
  pendingThumbnails: Accessor<Map<string, string>>; // assetId -> thumbnail file path
  setPendingThumbnails: Setter<Map<string, string>>;

  // Toast notifications
  showMetadataToast: Accessor<boolean>;
  setShowMetadataToast: Setter<boolean>;
  metadataToastMessage: Accessor<string>;
  setMetadataToastMessage: Setter<string>;

  // Moderation (pending submissions)
  pendingSubmissions: Accessor<Submission[]>;
  setPendingSubmissions: Setter<Submission[]>;
  reviewAction: Accessor<"approve" | "reject" | null>;
  setReviewAction: Setter<"approve" | "reject" | null>;
  rejectionReason: Accessor<string>;
  setRejectionReason: Setter<string>;
  reviewNotes: Accessor<string>;
  setReviewNotes: Setter<string>;
  submitting: Accessor<boolean>;
  setSubmitting: Setter<boolean>;
  selectedSubmissions: Accessor<Set<string>>;
  setSelectedSubmissions: Setter<Set<string>>;

  // Confirmation dialog
  confirmDialog: Accessor<{
    isOpen: boolean;
    title: string;
    message: string;
    variant?: "default" | "danger" | "warning";
    onConfirm: () => void;
  } | null>;
  setConfirmDialog: Setter<{
    isOpen: boolean;
    title: string;
    message: string;
    variant?: "default" | "danger" | "warning";
    onConfirm: () => void;
  } | null>;
}

export const useAssetState = (): AssetLibraryState => {
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
  const [editingAssetIds, setEditingAssetIds] = createSignal<Set<string>>(new Set());
  const [changedAssetId, setChangedAssetId] = createSignal<string | null>(null);
  const [appDataPath, setAppDataPath] = createSignal<string>("");
  const [thumbnailTimestamps, setThumbnailTimestamps] = createSignal<Map<string, number>>(new Map());
  const [pendingThumbnails, setPendingThumbnails] = createSignal<Map<string, string>>(new Map());
  const [pendingSubmissions, setPendingSubmissions] = createSignal<Submission[]>([]);
  const [reviewAction, setReviewAction] = createSignal<"approve" | "reject" | null>(null);
  const [rejectionReason, setRejectionReason] = createSignal("");
  const [reviewNotes, setReviewNotes] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [selectedSubmissions, setSelectedSubmissions] = createSignal<Set<string>>(new Set());
  const [confirmDialog, setConfirmDialog] = createSignal<{
    isOpen: boolean;
    title: string;
    message: string;
    variant?: "default" | "danger" | "warning";
    onConfirm: () => void;
  } | null>(null);

  return {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    selectedType,
    setSelectedType,
    selectedCategory,
    setSelectedCategory,
    downloading,
    setDownloading,
    selectedAsset,
    setSelectedAsset,
    isPanelOpen,
    setIsPanelOpen,
    downloadQueue,
    setDownloadQueue,
    isDownloadsPanelOpen,
    setIsDownloadsPanelOpen,
    viewMode,
    setViewMode,
    cachedAssets,
    setCachedAssets,
    editedAssets,
    setEditedAssets,
    showMetadataToast,
    setShowMetadataToast,
    metadataToastMessage,
    setMetadataToastMessage,
    originalEditedMetadata,
    setOriginalEditedMetadata,
    editingAssetIds,
    setEditingAssetIds,
    changedAssetId,
    setChangedAssetId,
    appDataPath,
    setAppDataPath,
    thumbnailTimestamps,
    setThumbnailTimestamps,
    pendingThumbnails,
    setPendingThumbnails,
    pendingSubmissions,
    setPendingSubmissions,
    reviewAction,
    setReviewAction,
    rejectionReason,
    setRejectionReason,
    reviewNotes,
    setReviewNotes,
    submitting,
    setSubmitting,
    selectedSubmissions,
    setSelectedSubmissions,
    confirmDialog,
    setConfirmDialog,
  };
};
