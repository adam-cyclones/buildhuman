import { config } from "../../config";
import type { AppSettings } from "../AssetLibrary/types";
import type { ReleaseData } from "./types";

const API_URL = config.apiUrl;

export const fetchReleases = async () => {
  const response = await fetch(`${API_URL}/api/releases`);
  if (!response.ok) throw new Error("Failed to fetch releases");
  return response.json();
};

export const fetchAssets = async () => {
  const response = await fetch(`${API_URL}/api/assets`);
  if (!response.ok) throw new Error("Failed to fetch assets");
  return response.json();
};

export const fetchPendingSubmissions = async (appSettings?: AppSettings) => {
  if (!appSettings?.moderator_api_key) {
    return [];
  }
  const response = await fetch(`${API_URL}/api/submissions/pending`, {
    headers: { "X-API-Key": appSettings.moderator_api_key },
  });
  if (!response.ok) {
    throw new Error("Failed to fetch pending submissions");
  }
  return response.json();
};

export const saveDraftRelease = async (releaseData: ReleaseData, apiKey: string) => {
  const response = await fetch(`${API_URL}/api/releases/draft`, {
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


export const publishRelease = async (releaseId: string, apiKey: string) => {
  const response = await fetch(`${API_URL}/api/releases/${releaseId}/publish`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to publish release");
  }

  return response.json();
};

export const reviewSubmission = async (submissionId: string, action: "approve" | "reject", apiKey: string, rejectionReason?: string) => {
  const response = await fetch(`${API_URL}/api/submissions/${submissionId}/review`, {
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

export const addAssetToRelease = async (releaseId: string, submissionId: string, apiKey: string) => {
  const response = await fetch(`${API_URL}/api/releases/${releaseId}/assets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      submission_id: submissionId,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to add asset to release");
  }

  return response.json();
};

export const unpublishRelease = async (releaseId: string, apiKey: string) => {
  const response = await fetch(`${API_URL}/api/releases/${releaseId}/unpublish`, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to unpublish release");
  }

  return response.json();
};

export const removeAssetFromRelease = async (releaseId: string, assetId: string, apiKey: string) => {
  const response = await fetch(`${API_URL}/api/releases/${releaseId}/assets/${assetId}`, {
    method: "DELETE",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to remove asset from release");
  }

  return response.json();
};

export const deleteRelease = async (releaseId: string, apiKey: string) => {
  const response = await fetch(`${API_URL}/api/releases/${releaseId}`, {
    method: "DELETE",
    headers: {
      "X-API-Key": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to delete release");
  }

  return response.json();
};