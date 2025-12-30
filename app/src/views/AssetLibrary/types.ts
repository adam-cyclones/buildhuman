/**
 * Shared types for AssetLibrary view
 */

export type Asset = {
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
};

export type LocalAsset = {
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
};

export type Category = {
  id: string;
  name: string;
  type_id: string;
};

export type Download = {
  id: string;
  name: string;
  status: "downloading" | "completed" | "failed";
  timestamp: number;
  error?: string;
};

export type Submission = {
  id: string;
  asset_name: string;
  asset_description?: string;
  asset_type: string;
  asset_category: string;
  author: string;
  file_size?: number;
  license: string;
  version: string;
  status: string;
  submitted_at: string;
  ai_moderation_result?: string;
  thumbnail_path?: string;
};

export type AppSettings = {
  author_name: string;
  default_editor: string;
  default_editor_type: string;
  custom_assets_folder: string;
  moderator_api_key: string;
  moderator_mode: boolean;
};

export type AssetLibraryProps = {
  appSettings: AppSettings | null;
  onTabChange?: (tab: string) => void;
};

export type AssetEvent = {
  type: string;
  timestamp: number;
  data?: any;
};

export type AssetMachines = {
  editing: any;
  publishing: any;
};

// Component prop types
export type AssetCardProps = {
  asset: Asset;
  onClick: (asset: Asset) => void;
  convertToAssetPath: (url: string, cacheBust: boolean) => string;
  thumbnailHasCacheBust: boolean;
  cachedAssets: import("solid-js").Accessor<Set<string>>;
  downloading: import("solid-js").Accessor<string | null>;
  onDownload: (id: string, name: string) => void;
  editedAssets?: import("solid-js").Accessor<Map<string, any>>;
  allAssets?: import("solid-js").Accessor<Asset[]>;
  onAssetClick?: (asset: Asset) => void;
};

export type AssetGridProps = {
  assets: import("solid-js").Accessor<Asset[]>;
  loading: boolean;
  error: any;
  viewMode: import("solid-js").Accessor<string>;
  selectedType: import("solid-js").Accessor<string>;
  apiUrl: string;
  onAssetClick: (asset: Asset) => void;
  convertToAssetPath: (url: string, cacheBust: boolean) => string;
  thumbnailTimestamps: import("solid-js").Accessor<Map<string, number>>;
  cachedAssets: import("solid-js").Accessor<Set<string>>;
  downloading: import("solid-js").Accessor<string | null>;
  onDownload: (id: string, name: string) => void;
  editedAssets?: import("solid-js").Accessor<Map<string, any>>;
  allAssets?: import("solid-js").Accessor<Asset[]>;
};

export type AssetFiltersProps = {
  searchQuery: import("solid-js").Accessor<string>;
  setSearchQuery: import("solid-js").Setter<string>;
  sortBy: import("solid-js").Accessor<string>;
  setSortBy: import("solid-js").Setter<string>;
  selectedType: import("solid-js").Accessor<string>;
  setSelectedType: import("solid-js").Setter<string>;
  selectedCategory: import("solid-js").Accessor<string>;
  setSelectedCategory: import("solid-js").Setter<string>;
  filteredCategories: import("solid-js").Accessor<Category[]>;
  assetCount: number;
  onSearch: () => void;
  showModeratorOptions?: boolean;
  viewMode: import("solid-js").Accessor<string>;
  setViewMode: import("solid-js").Setter<string>;
};

export type AssetDetailPanelProps = {
  selectedAsset: import("solid-js").Accessor<Asset | null>;
  setSelectedAsset: import("solid-js").Setter<Asset | null>;
  isEditingAsset: (id: string) => boolean;
  editedAssets: import("solid-js").Accessor<Map<string, LocalAsset>>;
  cachedAssets: import("solid-js").Accessor<Set<string>>;
  originalEditedMetadata: import("solid-js").Accessor<Map<string, Asset>>;
  convertToAssetPath: (thumbnailUrl: string, bustCache: boolean) => string;
  thumbnailTimestamps: import("solid-js").Accessor<Map<string, number>>;
  getRecentEvents: (assetId: string, limit?: number) => any[];
  selectedType: import("solid-js").Accessor<string>;
  downloading: import("solid-js").Accessor<string | null>;
  reviewAction: import("solid-js").Accessor<"approve" | "reject" | null>;
  setReviewAction: import("solid-js").Setter<"approve" | "reject" | null>;
  rejectionReason: import("solid-js").Accessor<string>;
  setRejectionReason: import("solid-js").Setter<string>;
  reviewNotes: import("solid-js").Accessor<string>;
  setReviewNotes: import("solid-js").Setter<string>;
  submitting: import("solid-js").Accessor<boolean>;
  appSettings: any;
  onClose: () => void;
  onChangeThumbnail: (assetId: string) => void;
  onOpenInBlender: (assetId: string) => void;
  onSaveMetadata: (assetId: string) => Promise<void>;
  onPublishAsset: (assetId: string) => void;
  onDeleteCached: (assetId: string, name: string) => void;
  onRevertToOriginal: (assetId: string) => void;
  onReview: (assetId: string) => void;
  onDownload: (assetId: string, name: string) => void;
  onEditAsset: (assetId: string) => void;
  onOpenSettings: () => void;
  isLicenseEditable: (license: string) => boolean;
  showMetadataSaveToast: (message: string, duration: number) => void;
};

export type ActivityTimelineProps = {
  events: AssetEvent[];
};

export type FormattedEvent = {
  icon: string;
  title: string;
  desc: string;
  time: string;
  warning?: boolean;
};
