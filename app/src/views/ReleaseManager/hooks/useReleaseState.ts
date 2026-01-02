import { createSignal, createResource, onMount, createEffect } from "solid-js";
import { fetchReleases, fetchAssets, fetchPendingSubmissions } from "../client";
import type { Release, Asset, Submission } from "../types";

export function useReleaseState(props: { appSettings: any }) {
  const [viewMode, setViewMode] = createSignal<"releases" | "review">("releases");
  const [selectedReleaseId, setSelectedReleaseId] = createSignal<string | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = createSignal<string | null>(null);
  const [releases, setReleases] = createSignal<Release[]>([]);
  const [draftReleases, setDraftReleases] = createSignal<Release[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = createSignal<Submission[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isCreatingNew, setIsCreatingNew] = createSignal(false);

  // Form state for creating a new release
  const [newReleaseName, setNewReleaseName] = createSignal("");
  const [newReleaseVersion, setNewReleaseVersion] = createSignal("");
  const [newReleaseDescription, setNewReleaseDescription] = createSignal("");

  const [availableAssets] = createResource(fetchAssets);

  const loadPendingSubmissions = async () => {
    const submissions = await fetchPendingSubmissions(props.appSettings);
    setPendingSubmissions(submissions);
  };

  onMount(async () => {
    const data = await fetchReleases();
    setReleases(data);
    setDraftReleases(data.filter((r: Release) => r.status === "draft"));

    if (props.appSettings?.moderator_mode) {
      loadPendingSubmissions();
    }
  });

  createEffect(() => {
    if (viewMode() === "review" && props.appSettings?.moderator_mode) {
      loadPendingSubmissions();
    }
  });

  const candidateAssets = () => {
    const assets = availableAssets() || [];
    return assets.filter((asset: Asset) => !asset.required && asset.submission_status !== "pending");
  };

  const filteredAssets = () => {
    const query = searchQuery().toLowerCase();
    const assets = candidateAssets();
    if (!query) return assets;

    return assets.filter((asset: Asset) =>
      asset.name.toLowerCase().includes(query) ||
      asset.type.toLowerCase().includes(query) ||
      asset.category.toLowerCase().includes(query)
    );
  };

  return {
    viewMode,
    setViewMode,
    selectedReleaseId,
    setSelectedReleaseId,
    selectedSubmissionId,
    setSelectedSubmissionId,
    releases,
    setReleases,
    draftReleases,
    setDraftReleases,
    pendingSubmissions,
    setPendingSubmissions,
    searchQuery,
    setSearchQuery,
    isCreatingNew,
    setIsCreatingNew,
    availableAssets,
    filteredAssets,
    loadPendingSubmissions,
    newReleaseName,
    setNewReleaseName,
    newReleaseVersion,
    setNewReleaseVersion,
    newReleaseDescription,
    setNewReleaseDescription,
  };
}