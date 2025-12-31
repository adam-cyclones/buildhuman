/**
 * API functions for AssetLibrary
 * All data fetching and external API calls
 */

import { invoke } from "@tauri-apps/api/core";
import { config } from "../../config";
import type { LocalAsset } from "./types";

const API_URL = config.apiUrl;

/**
 * Fetch assets from API with optional filters
 */
export const fetchAssets = async (params: {
  selectedCategory: string;
  searchQuery: string;
  sortBy: string;
}) => {
  const urlParams = new URLSearchParams();

  if (params.selectedCategory !== "all") {
    urlParams.append("category", params.selectedCategory);
  }
  if (params.searchQuery) {
    urlParams.append("search", params.searchQuery);
  }
  urlParams.append("sort", params.sortBy);

  const url = `${API_URL}/api/assets?${urlParams}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Failed to fetch assets");
  }

  return response.json();
};

/**
 * Fetch categories from API
 */
export const fetchCategories = async () => {
  const response = await fetch(`${API_URL}/api/categories`);
  if (!response.ok) {
    throw new Error("Failed to fetch categories");
  }
  return response.json();
};

/**
 * Fetch pending submissions (for moderators)
 */
export const fetchPendingSubmissions = async (appSettings?: {
  moderator_mode?: boolean;
  moderator_api_key?: string;
}) => {
  if (!appSettings?.moderator_mode || !appSettings?.moderator_api_key) {
    return [];
  }

  try {
    const response = await fetch(`${API_URL}/api/submissions/pending`, {
      headers: {
        "X-API-Key": appSettings.moderator_api_key
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch pending submissions");
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to fetch pending submissions:", error);
    return [];
  }
};

/**
 * Fetch cached assets from local storage (Tauri)
 */
export const fetchCachedAssets = async () => {
  try {
    const cached = await invoke<LocalAsset[]>("list_cached_assets");
    console.log("📦 Loaded cached assets:", cached);
    return cached;
  } catch (error) {
    console.error("Failed to fetch cached assets:", error);
    throw error;
  }
};

/**
 * Submit review for a submission (moderator action)
 */
export const submitReview = async (params: {
  submissionId: string;
  action: "approve" | "reject";
  rejectionReason?: string;
  apiKey: string;
}) => {
  const response = await fetch(
    `${API_URL}/api/submissions/${params.submissionId}/review`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": params.apiKey
      },
      body: JSON.stringify({
        action: params.action,
        rejection_reason: params.action === "reject" ? params.rejectionReason : undefined
      })
    }
  );

  if (!response.ok) {
    throw new Error("Failed to submit review");
  }

  return response.json();
};

/**
 * Publish asset to service
 */
export const publishAssetToService = async (params: {
  formData: FormData;
}) => {
  const response = await fetch(`${API_URL}/api/submissions`, {
    method: "POST",
    body: params.formData
  });

  if (!response.ok) {
    throw new Error("Failed to submit asset");
  }

  return response.json();
};
