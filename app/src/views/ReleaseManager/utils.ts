import { config } from "../../config";
import type { ReleaseStatus } from "./types";

export const buildThumbnailUrl = (thumbnailPath?: string) => {
  if (!thumbnailPath) return "";
  return `${config.apiUrl}/${thumbnailPath}`;
};

export const isRejectionReasonValid = (reason: string) => {
  return reason.trim().length > 0;
};

export const isReleaseMetadataValid = (name: string, version: string) => {
  return name.trim().length > 0 && version.trim().length > 0;
};

export const canPublishRelease = (name: string, version: string, assetIds: string[]) => {
  return isReleaseMetadataValid(name, version) && assetIds.length > 0;
};

export const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

export const getStatusColor = (status: ReleaseStatus) => {
  switch (status) {
    case "production":
      return "status-production";
    case "staging":
      return "status-staging";
    case "draft":
      return "status-draft";
    case "deprecated":
      return "status-deprecated";
  }
};

export const getAssetTypeIcon = (type: string): string => {
  const normalizedType = type.toLowerCase();
  if (normalizedType === "model" || normalizedType === "models") return "box";
  if (normalizedType === "texture" || normalizedType === "textures") return "image";
  if (normalizedType === "animation" || normalizedType === "animations") return "move";
  return "file";
};

export const getAssetTypeColor = (type: string): string => {
  const normalizedType = type.toLowerCase();
  if (normalizedType === "model" || normalizedType === "models") return "type-model";
  if (normalizedType === "texture" || normalizedType === "textures") return "type-texture";
  if (normalizedType === "animation" || normalizedType === "animations") return "type-animation";
  return "type-other";
};

export const getNextVersionString = (versions: string[]): string => {

  const today = new Date();

  const month = (today.getMonth() + 1).toString().padStart(2, "0");

  const year = today.getFullYear().toString().slice(-2);

  const datePrefix = `${month}-${year}`;



  const monthlyReleases = versions.filter((v) => v.startsWith(`${datePrefix}.R`));



  let nextReleaseNumber = 1;

  if (monthlyReleases.length > 0) {

    const releaseNumbers = monthlyReleases.map((v) => {

      const match = v.match(/\.R(\d+)$/);

      return match ? parseInt(match[1], 10) : 0;

    });

    nextReleaseNumber = Math.max(...releaseNumbers) + 1;

  }



  return `${datePrefix}.R${nextReleaseNumber}`;

};


