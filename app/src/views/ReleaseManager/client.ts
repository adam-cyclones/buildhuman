/**
 * API client functions for ReleaseManager
 * Pure functions that return Promises
 */

import type { Release, Asset, Submission, ReleaseData } from "./types";

const API_BASE_URL = "http://localhost:8000";

/**
 * Fetch all releases from the API
 */
export const fetchReleases = async (): Promise<Release[]> => {
  const response = await fetch(`${API_BASE_URL}/api/releases`);
  if (!response.ok) throw new Error("Failed to fetch releases");
  return response.json();
};

/**
 * Fetch all available assets from the API
 */
export const fetchAssets = async (): Promise<Asset[]> => {
  const response = await fetch(`${API_BASE_URL}/api/assets`);
  if (!response.ok) throw new Error("Failed to fetch assets");
  return response.json();
};

/**
 * Fetch pending submissions from the API
 */
export const fetchPendingSubmissions = async (appSettings: any): Promise<Submission[]> => {
  if (!appSettings?.moderator_api_key) {
    throw new Error("Moderator API key required");
  }

  const response = await fetch(`${API_BASE_URL}/api/submissions/pending`, {
    headers: {
      "X-API-Key": appSettings.moderator_api_key,
    },
  });

  if (!response.ok) throw new Error("Failed to fetch pending submissions");
  return response.json();
};

/**
 * Save a draft release
 */
export const saveDraftRelease = async (
  releaseData: ReleaseData,
  apiKey: string
): Promise<Release> => {
  if (!apiKey) {
    throw new Error("Moderator API key required");
  }

  const response = await fetch(`${API_BASE_URL}/api/releases/draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      name: releaseData.name,
      version: releaseData.version,
      description: releaseData.description,
      asset_ids: releaseData.assetIds,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to create draft release");
  }

  return response.json();
};

/**
 * Publish a release
 */
export const publishRelease = async (releaseId: string, apiKey: string): Promise<void> => {
  if (!apiKey) {
    throw new Error("Moderator API key required");
  }

  const response = await fetch(`${API_BASE_URL}/api/releases/${releaseId}/publish`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to publish release");
  }
};

/**
 * Review a submission (approve or reject)
 */
export const reviewSubmission = async (
  submissionId: string,
  action: "approve" | "reject",
  apiKey: string,
  rejectionReason?: string
): Promise<void> => {
  if (!apiKey) {
    throw new Error("Moderator API key required");
  }

  const response = await fetch(`${API_BASE_URL}/api/submissions/${submissionId}/review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      action,
      rejection_reason: action === "reject" ? rejectionReason : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to ${action} submission`);
  }
};
