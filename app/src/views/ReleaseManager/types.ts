/**
 * Type definitions for ReleaseManager
 */

import type { Release, Asset as LibraryAsset, Submission } from "../AssetLibrary/types";

/**
 * Extended Asset type with release-specific metadata
 */
export type ReleaseAsset = LibraryAsset & {
  size?: number;
  uploadedAt?: Date;
  commitMessage?: string;
  thumbnail?: string;
  folder?: string;
};

/**
 * Release status types
 */
export type ReleaseStatus = "draft" | "staging" | "production" | "deprecated";

/**
 * Extended Release type with full metadata
 */
export type ExtendedRelease = {
  id: string;
  version: string;
  name: string;
  description: string;
  createdAt: Date;
  status: ReleaseStatus;
  author: string;
  branch: string;
  assets: ReleaseAsset[];
  deployedAt?: Date;
};

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
  availableAssets: LibraryAsset[];
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
 * Submission review state tracking
 */
export type SubmissionState = {
  status: "pending" | "approved" | "addedToRelease" | "rejected";
  releaseId?: string;
  releaseName?: string;
};

/**
 * Re-export types from AssetLibrary for convenience
 */
export type { Release, Submission };
