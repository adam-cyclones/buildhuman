/**
 * Event handler factories for ReleaseManager
 * Each handler receives dependencies explicitly via factory pattern
 */

import type { ReleaseManagerState } from "./hooks/useReleaseState";
import type { ReleaseData } from "./types";
import {
  fetchReleases,
  fetchPendingSubmissions,
  saveDraftRelease,
  publishRelease,
  reviewSubmission,
} from "./client";
import { filterReleasesByStatus } from "./utils";

/**
 * Dependencies required by handlers
 */
export type HandlerDependencies = ReleaseManagerState & {
  appSettings: any;
};

/**
 * Create handler for creating a new release
 */
export const createNewReleaseHandler = (deps: HandlerDependencies) => async () => {
  deps.setIsCreatingNew(true);
  deps.setViewMode("releases");
};

/**
 * Create handler for saving a draft release
 */
export const createSaveDraftHandler = (deps: HandlerDependencies) => async (
  releaseData: ReleaseData
) => {
  if (!deps.appSettings?.moderator_api_key) {
    throw new Error("Moderator API key required");
  }

  const newRelease = await saveDraftRelease(releaseData, deps.appSettings.moderator_api_key);
  deps.setDraftReleases([...deps.draftReleases(), newRelease]);
  deps.setSelectedReleaseId(newRelease.id);
  deps.setIsCreatingNew(false);
};

/**
 * Create handler for publishing a release
 */
export const createPublishHandler = (deps: HandlerDependencies) => async (releaseId: string) => {
  if (!deps.appSettings?.moderator_api_key) {
    throw new Error("Moderator API key required");
  }

  await publishRelease(releaseId, deps.appSettings.moderator_api_key);

  // Refresh data
  const data = await fetchReleases();
  deps.setReleases(data);
  deps.setDraftReleases(filterReleasesByStatus(data, "draft"));
  deps.setSelectedReleaseId(null);
};

/**
 * Create handler for reviewing a submission (approve or reject)
 */
export const createReviewHandler = (deps: HandlerDependencies) => async (
  submissionId: string,
  action: "approve" | "reject",
  rejectionReason?: string
) => {
  if (!deps.appSettings?.moderator_api_key) {
    throw new Error("Moderator API key required");
  }

  await reviewSubmission(
    submissionId,
    action,
    deps.appSettings.moderator_api_key,
    rejectionReason
  );

  // Refresh submissions list
  const submissions = await fetchPendingSubmissions(deps.appSettings);
  deps.setPendingSubmissions(submissions);
  deps.setSelectedSubmissionId(null);
};

/**
 * Create handler for switching to review mode
 */
export const createSwitchToReviewHandler = (deps: HandlerDependencies) => () => {
  deps.setViewMode("review");
  deps.setSelectedReleaseId(null);
  deps.setIsCreatingNew(false);
};

/**
 * Create handler for switching to releases mode
 */
export const createSwitchToReleasesHandler = (deps: HandlerDependencies) => () => {
  deps.setViewMode("releases");
  deps.setSelectedSubmissionId(null);
};

/**
 * Create handler for loading releases data
 */
export const createLoadReleasesHandler = (deps: HandlerDependencies) => async () => {
  const data = await fetchReleases();
  deps.setReleases(data);
  deps.setDraftReleases(filterReleasesByStatus(data, "draft"));
};

/**
 * Create handler for loading pending submissions
 */
export const createLoadSubmissionsHandler = (deps: HandlerDependencies) => async () => {
  if (!deps.appSettings?.moderator_mode) return;

  const submissions = await fetchPendingSubmissions(deps.appSettings);
  deps.setPendingSubmissions(submissions);
};
