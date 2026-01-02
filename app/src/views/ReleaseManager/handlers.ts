import { saveDraftRelease, publishRelease, reviewSubmission, fetchReleases } from "./client";
import type { ReleaseManagerProps } from "./types";
import { useReleaseState } from "./hooks/useReleaseState";

type HandlerDeps = ReturnType<typeof useReleaseState> & {
  appSettings: ReleaseManagerProps["appSettings"];
};

export const createReleaseHandlers = (deps: HandlerDeps) => {
  const handleCreateDraft = async () => {
    if (!deps.appSettings?.moderator_api_key) {
      throw new Error("Moderator API key required");
    }

    const releaseData = {
      name: deps.newReleaseName(),
      version: deps.newReleaseVersion(),
      description: deps.newReleaseDescription(),
      assetIds: [], // Start with no assets
    };

    const newRelease = await saveDraftRelease(releaseData, deps.appSettings.moderator_api_key);
    deps.setDraftReleases([newRelease, ...deps.draftReleases()]);
    
    // Clear form
    deps.setNewReleaseName("");
    deps.setNewReleaseVersion("");
    deps.setNewReleaseDescription("");

    // Select the new release for editing
    deps.setSelectedReleaseId(newRelease.id);
    deps.setIsCreatingNew(false);
  };

  const handleSaveDraft = async (releaseData: {
    name: string;
    version: string;
    description: string;
    assetIds: string[];
  }) => {
    if (!deps.appSettings?.moderator_api_key) {
      throw new Error("Moderator API key required");
    }
    const newRelease = await saveDraftRelease(releaseData, deps.appSettings.moderator_api_key);
    deps.setDraftReleases([...deps.draftReleases(), newRelease]);
    deps.setSelectedReleaseId(newRelease.id);
    deps.setIsCreatingNew(false);
  };

  const handlePublishRelease = async (releaseId: string) => {
    if (!deps.appSettings?.moderator_api_key) {
      throw new Error("Moderator API key required");
    }
    await publishRelease(releaseId, deps.appSettings.moderator_api_key);
    const data = await fetchReleases();
    deps.setReleases(data);
    deps.setDraftReleases(data.filter((r: any) => r.status === "draft"));
    deps.setSelectedReleaseId(null);
  };

  const handleReviewSubmission = async (submissionId: string, action: "approve" | "reject", rejectionReason?: string) => {
    if (!deps.appSettings?.moderator_api_key) {
      throw new Error("Moderator API key required");
    }
    await reviewSubmission(submissionId, action, deps.appSettings.moderator_api_key, rejectionReason);
    await deps.loadPendingSubmissions();
    deps.setSelectedSubmissionId(null);
  };

  const handleSwitchToReview = () => {
    deps.setViewMode("review");
    deps.setSelectedReleaseId(null);
    deps.setIsCreatingNew(false);
  };

  const handleSwitchToReleases = () => {
    deps.setViewMode("releases");
    deps.setSelectedSubmissionId(null);
  };

  return {
    handleCreateDraft,
    handleSaveDraft,
    handlePublishRelease,
    handleReviewSubmission,
    handleSwitchToReview,
    handleSwitchToReleases,
  };
};