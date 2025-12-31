/**
 * Type definitions for ReleaseManager
 */

import type { Release, Asset, Submission } from "../AssetLibrary/types";

/**
 * View mode for the release manager
 */
export type ViewMode = "releases" | "review";

/**
 * Props for the main ReleaseManager component
 */
export type ReleaseManagerProps = {
  appSettings: any;
  onBack?: () => void;
};

/**
 * Props for the ReleaseEditor component
 */
export type ReleaseEditorProps = {
  releaseId: string | null;
  isNew: boolean;
  availableAssets: Asset[];
  onSave: (data: ReleaseData) => Promise<void>;
  onPublish: (releaseId: string) => Promise<void>;
  onCancel: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
};

/**
 * Props for the ReviewPanel component
 */
export type ReviewPanelProps = {
  submission: Submission;
  onApprove: (rejectionReason?: string) => Promise<void>;
  onReject: (rejectionReason: string) => Promise<void>;
  onClose: () => void;
};

/**
 * Data structure for saving release metadata
 */
export type ReleaseData = {
  name: string;
  version: string;
  description: string;
  assetIds: string[];
};

/**
 * Re-export types from AssetLibrary for convenience
 */
export type { Release, Asset, Submission };
