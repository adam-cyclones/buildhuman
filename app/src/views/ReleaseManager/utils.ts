/**
 * Utility functions for ReleaseManager
 * Pure functions without side effects
 */

import type { Asset, Release, Submission } from "./types";

/**
 * Filter assets to only show candidates for releases
 * (published, non-required assets only)
 */
export const filterCandidateAssets = (assets: Asset[]): Asset[] => {
  return assets.filter((asset) => !asset.required && asset.submission_status !== "pending");
};

/**
 * Filter assets by search query
 * Searches across name, type, and category
 */
export const filterAssetsBySearch = (assets: Asset[], query: string): Asset[] => {
  if (!query) return assets;

  const queryLower = query.toLowerCase();
  return assets.filter(
    (asset) =>
      asset.name.toLowerCase().includes(queryLower) ||
      asset.type.toLowerCase().includes(queryLower) ||
      asset.category.toLowerCase().includes(queryLower)
  );
};

/**
 * Filter releases by status
 */
export const filterReleasesByStatus = (releases: Release[], status: string): Release[] => {
  return releases.filter((release) => release.status === status);
};

/**
 * Build full thumbnail URL from path
 */
export const buildThumbnailUrl = (thumbnailPath: string | undefined): string => {
  if (!thumbnailPath) return "";
  return `http://localhost:8000${thumbnailPath}`;
};

/**
 * Validate release metadata
 */
export const isReleaseMetadataValid = (name: string, version: string): boolean => {
  return Boolean(name && version);
};

/**
 * Check if release can be published
 */
export const canPublishRelease = (name: string, version: string, assetIds: string[]): boolean => {
  return isReleaseMetadataValid(name, version) && assetIds.length > 0;
};

/**
 * Validate rejection reason
 */
export const isRejectionReasonValid = (reason: string): boolean => {
  return Boolean(reason.trim());
};
