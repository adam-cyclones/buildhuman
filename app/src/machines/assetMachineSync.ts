/**
 * Asset Machine State Synchronization
 * Bridges between XState machines and asset metadata persistence
 */

import { AssetEditingContext } from "./assetEditingMachine";
import { AssetPublishingContext } from "./assetPublishingMachine";

export interface AssetMetadata {
  id: string;
  name: string;
  submission_id?: string;
  submission_status?: "pending" | "approved" | "rejected";
  last_edited_after_publish?: boolean;
  [key: string]: any;
}

/**
 * Convert publishing machine context to metadata
 */
export const publishingToMetadata = (context: AssetPublishingContext): Partial<AssetMetadata> => {
  return {
    submission_id: context.submissionId,
    submission_status:
      context.submissionId && !context.editedAfterSubmit ? "pending" :
      context.editedAfterSubmit ? "pending" :  // Still pending but has edits
      undefined,
    last_edited_after_publish: context.editedAfterSubmit,
  };
};

/**
 * Convert metadata to publishing machine context
 */
export const metadataToPublishing = (metadata: AssetMetadata): Partial<AssetPublishingContext> => {
  return {
    assetId: metadata.id,
    assetName: metadata.name,
    submissionId: metadata.submission_id,
    editedAfterSubmit: metadata.last_edited_after_publish || false,
  };
};

/**
 * Convert editing machine context to metadata
 * (Currently metadata doesn't store editing state, but could be extended)
 */
export const editingToMetadata = (_context: AssetEditingContext): Partial<AssetMetadata> => {
  // Could store unsaved_changes flag, last_saved_at, etc.
  return {};
};

/**
 * Determine publishing machine initial state from metadata
 */
export const getPublishingState = (metadata: AssetMetadata): string => {
  if (!metadata.submission_id) return "editing";
  if (metadata.submission_status === "pending") {
    return metadata.last_edited_after_publish ? "pendingWithEdits" : "pending";
  }
  if (metadata.submission_status === "approved") return "approved";
  if (metadata.submission_status === "rejected") return "rejected";
  return "editing";
};

/**
 * Create machine context from asset metadata
 */
export const createMachineContext = (
  metadata: AssetMetadata
): {
  publishing: Partial<AssetPublishingContext>;
  editing: Partial<AssetEditingContext>;
} => {
  return {
    publishing: metadataToPublishing(metadata),
    editing: {
      assetId: metadata.id,
      hasUnsavedChanges: false,
      changes: {
        metadata: false,
        file: false,
        thumbnail: false,
      },
      autoSaveEnabled: true,
    },
  };
};
