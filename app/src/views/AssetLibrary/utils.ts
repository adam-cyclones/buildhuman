/**
 * Utility functions for AssetLibrary
 * Pure functions without side effects
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { useAssetEditing } from "../../machines/useAssetEditing";
import { useAssetPublishing } from "../../machines/useAssetPublishing";
import type { Asset, AssetMachines, LocalAsset, Submission } from "./types";

/**
 * Initialize or get state machine for an asset
 */
export const createAssetMachine = (
  assetId: string,
  metadata?: any,
  existingMachines?: Map<string, AssetMachines>
): AssetMachines => {
  let machines = existingMachines?.get(assetId);

  if (!machines) {
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

    // Move machine to correct state based on metadata
    if (metadata?.submission_status === "pending") {
      machines.publishing.send({ type: "SUBMIT" });
      machines.publishing.send({ type: "SUBMIT_SUCCESS", submissionId: metadata.submission_id });

      if (metadata.last_edited_after_publish) {
        machines.publishing.send({ type: "EDIT" });
      }
    }
  }

  return machines;
};

/**
 * Check if asset is currently being edited
 */
export const isEditingAsset = (assetId: string, editedAssets: Map<string, LocalAsset>) => {
  return editedAssets.has(assetId) || assetId.endsWith("_editing");
};

/**
 * Check if a license allows editing/modification
 */
export const isLicenseEditable = (license: string) => {
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

/**
 * Check if metadata has changed from original
 */
export const hasMetadataChanges = (
  editedId: string,
  originalEditedMetadata: Map<string, Asset>,
  currentAsset: Asset | null
) => {
  const original = originalEditedMetadata.get(editedId);

  if (!original || !currentAsset) return false;

  return (
    original.name !== currentAsset.name ||
    original.version !== currentAsset.version ||
    original.type !== currentAsset.type ||
    original.category !== currentAsset.category ||
    original.description !== currentAsset.description
  );
};

/**
 * Convert local file path to Tauri asset protocol URL
 */
export const convertToAssetPath = (
  thumbnailUrl: string,
  appDataPath: string,
  bustCache = false
) => {
  if (thumbnailUrl.startsWith('http')) {
    return thumbnailUrl; // External URL
  }

  if (!appDataPath) {
    return ''; // App data path not loaded yet
  }

  const fullPath = `${appDataPath}/created-assets/${thumbnailUrl}`;
  const url = convertFileSrc(fullPath);

  // Add cache-busting timestamp if needed
  return bustCache ? `${url}?t=${Date.now()}` : url;
};

/**
 * Format timestamp as "time ago" string
 */
export const formatTimeAgo = (timestamp: number) => {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

/**
 * Merge API assets with local edited assets and sort
 */
export const mergeAndSortAssets = (
  apiAssets: Asset[],
  localAssets: LocalAsset[],
  selectedType: string,
  pendingSubmissions: Submission[]
): Asset[] => {
  // If viewing pending submissions, return those instead
  if (selectedType === "pending") {
    return pendingSubmissions.map(submission => ({
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
    }));
  }

  const localAssetMetadata = localAssets.map(local => local.metadata as Asset);

  // Combine both
  const combined: Asset[] = [...apiAssets, ...localAssetMetadata];

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

/**
 * Filter categories by selected type
 */
export const filterCategories = (categories: any[], selectedType: string) => {
  if (!categories) return [];
  if (selectedType === "all") return categories;
  return categories.filter((cat: any) => cat.type_id === selectedType);
};
