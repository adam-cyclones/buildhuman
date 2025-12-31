/**
 * State management hook for ReleaseManager
 * Centralizes all component state using SolidJS signals
 */

import { createSignal, Accessor, Setter } from "solid-js";
import type { ViewMode, Release, Submission } from "../types";

export type ReleaseManagerState = {
  // View mode
  viewMode: Accessor<ViewMode>;
  setViewMode: Setter<ViewMode>;

  // Selected items
  selectedReleaseId: Accessor<string | null>;
  setSelectedReleaseId: Setter<string | null>;
  selectedSubmissionId: Accessor<string | null>;
  setSelectedSubmissionId: Setter<string | null>;

  // Data collections
  releases: Accessor<Release[]>;
  setReleases: Setter<Release[]>;
  draftReleases: Accessor<Release[]>;
  setDraftReleases: Setter<Release[]>;
  pendingSubmissions: Accessor<Submission[]>;
  setPendingSubmissions: Setter<Submission[]>;

  // UI state
  searchQuery: Accessor<string>;
  setSearchQuery: Setter<string>;
  isCreatingNew: Accessor<boolean>;
  setIsCreatingNew: Setter<boolean>;
};

/**
 * Custom hook for ReleaseManager state management
 */
export const useReleaseState = (): ReleaseManagerState => {
  // View mode
  const [viewMode, setViewMode] = createSignal<ViewMode>("releases");

  // Selected items
  const [selectedReleaseId, setSelectedReleaseId] = createSignal<string | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = createSignal<string | null>(null);

  // Data collections
  const [releases, setReleases] = createSignal<Release[]>([]);
  const [draftReleases, setDraftReleases] = createSignal<Release[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = createSignal<Submission[]>([]);

  // UI state
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isCreatingNew, setIsCreatingNew] = createSignal(false);

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
  };
};
