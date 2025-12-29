/**
 * Shared types for AssetLibrary view
 */

export interface Asset {
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

export interface LocalAsset {
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

export interface Category {
  id: string;
  name: string;
  type_id: string;
}

export interface Download {
  id: string;
  name: string;
  status: "downloading" | "completed" | "failed";
  timestamp: number;
  error?: string;
}

export interface Submission {
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
}

export interface AppSettings {
  author_name: string;
  default_editor: string;
  default_editor_type: string;
  custom_assets_folder: string;
  moderator_api_key: string;
  moderator_mode: boolean;
}

export interface AssetLibraryProps {
  appSettings: AppSettings | null;
}

export interface AssetEvent {
  type: string;
  timestamp: string;
  data?: any;
}

export interface AssetMachines {
  editing: any;
  publishing: any;
}
