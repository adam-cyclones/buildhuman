import { createSignal, createResource, For, Show, onMount, createEffect } from "solid-js";
import { createActor } from "xstate";
import Icon from "../../components/Icon";
import { releaseMachine } from "../AssetLibrary/machines/releaseMachine";
import { fetchPendingSubmissions } from "../AssetLibrary/client";
import type { Release, Asset, Submission } from "../AssetLibrary/types";
import "./ReleaseManager.css";

export type ReleaseManagerProps = {
  appSettings: any;
  onBack?: () => void;
};

type ViewMode = "releases" | "review";

const ReleaseManager = (props: ReleaseManagerProps) => {
  const [viewMode, setViewMode] = createSignal<ViewMode>("releases");
  const [selectedReleaseId, setSelectedReleaseId] = createSignal<string | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = createSignal<string | null>(null);
  const [releases, setReleases] = createSignal<Release[]>([]);
  const [draftReleases, setDraftReleases] = createSignal<Release[]>([]);
  const [pendingSubmissions, setPendingSubmissions] = createSignal<Submission[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [isCreatingNew, setIsCreatingNew] = createSignal(false);

  // Fetch releases
  const fetchReleases = async () => {
    const response = await fetch("http://localhost:8000/api/releases");
    if (!response.ok) throw new Error("Failed to fetch releases");
    return response.json();
  };

  // Fetch available assets
  const fetchAssets = async () => {
    const response = await fetch("http://localhost:8000/api/assets");
    if (!response.ok) throw new Error("Failed to fetch assets");
    return response.json();
  };

  const [availableAssets] = createResource(fetchAssets);

  // Load releases and submissions on mount
  onMount(async () => {
    const data = await fetchReleases();
    setReleases(data);
    setDraftReleases(data.filter((r: Release) => r.status === "draft"));

    // Load pending submissions if moderator
    if (props.appSettings?.moderator_mode) {
      loadPendingSubmissions();
    }
  });

  // Load pending submissions
  const loadPendingSubmissions = async () => {
    const submissions = await fetchPendingSubmissions(props.appSettings);
    setPendingSubmissions(submissions);
  };

  // Auto-refresh submissions when switching to review mode
  createEffect(() => {
    if (viewMode() === "review" && props.appSettings?.moderator_mode) {
      loadPendingSubmissions();
    }
  });

  // Filter assets for release (published, non-required only)
  const candidateAssets = () => {
    const assets = availableAssets() || [];
    return assets.filter((asset: Asset) => !asset.required && asset.submission_status !== "pending");
  };

  // Filter assets by search
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

  const handleCreateNewRelease = async () => {
    setIsCreatingNew(true);
    setViewMode("releases");
  };

  const handleSaveDraft = async (releaseData: {
    name: string;
    version: string;
    description: string;
    assetIds: string[];
  }) => {
    if (!props.appSettings?.moderator_api_key) {
      throw new Error("Moderator API key required");
    }

    const response = await fetch("http://localhost:8000/api/releases/draft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": props.appSettings.moderator_api_key,
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

    const newRelease = await response.json();
    setDraftReleases([...draftReleases(), newRelease]);
    setSelectedReleaseId(newRelease.id);
    setIsCreatingNew(false);
  };

  const handlePublishRelease = async (releaseId: string) => {
    if (!props.appSettings?.moderator_api_key) {
      throw new Error("Moderator API key required");
    }

    const response = await fetch(`http://localhost:8000/api/releases/${releaseId}/publish`, {
      method: "POST",
      headers: {
        "X-API-Key": props.appSettings.moderator_api_key,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to publish release");
    }

    // Remove from drafts, refresh data
    const data = await fetchReleases();
    setReleases(data);
    setDraftReleases(data.filter((r: Release) => r.status === "draft"));
    setSelectedReleaseId(null);
  };

  const handleReviewSubmission = async (submissionId: string, action: "approve" | "reject", rejectionReason?: string) => {
    if (!props.appSettings?.moderator_api_key) {
      throw new Error("Moderator API key required");
    }

    const response = await fetch(`http://localhost:8000/api/submissions/${submissionId}/review`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": props.appSettings.moderator_api_key,
      },
      body: JSON.stringify({
        action,
        rejection_reason: action === "reject" ? rejectionReason : undefined,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to ${action} submission`);
    }

    // Refresh submissions list
    await loadPendingSubmissions();
    setSelectedSubmissionId(null);
  };

  const handleSwitchToReview = () => {
    setViewMode("review");
    setSelectedReleaseId(null);
    setIsCreatingNew(false);
  };

  const handleSwitchToReleases = () => {
    setViewMode("releases");
    setSelectedSubmissionId(null);
  };

  return (
    <div class="release-manager">
      <div class="release-manager-header">
        <Show when={props.onBack}>
          <button class="back-btn" onClick={props.onBack}>
            <Icon name="arrow-down" size={20} style={{ transform: "rotate(90deg)" }} />
            Back to Assets
          </button>
        </Show>
        <h1>Release Management</h1>
        <button class="create-release-btn" onClick={handleCreateNewRelease}>
          <Icon name="plus" size={20} />
          New Release
        </button>
      </div>

      <div class="release-manager-content">
        {/* Left panel - Mode selector and lists */}
        <div class="releases-panel">
          {/* View mode tabs */}
          <div class="view-mode-tabs">
            <button
              class={`mode-tab ${viewMode() === "releases" ? "active" : ""}`}
              onClick={handleSwitchToReleases}
            >
              <Icon name="rocket" size={16} />
              Releases
            </button>
            <button
              class={`mode-tab ${viewMode() === "review" ? "active" : ""}`}
              onClick={handleSwitchToReview}
            >
              <Icon name="shield" size={16} />
              Review
              <Show when={pendingSubmissions().length > 0}>
                <span class="review-count">{pendingSubmissions().length}</span>
              </Show>
            </button>
          </div>

          {/* Releases list */}
          <Show when={viewMode() === "releases"}>
            <div class="panel-header">
              <h2>Draft Releases</h2>
              <span class="count">{draftReleases().length}</span>
            </div>

            <div class="releases-list">
              <Show when={draftReleases().length === 0}>
                <div class="empty-state">
                  <Icon name="rocket" size={48} />
                  <p>No draft releases</p>
                  <span>Create a new release to get started</span>
                </div>
              </Show>

              <For each={draftReleases()}>
                {(release) => (
                  <div
                    class={`release-item ${selectedReleaseId() === release.id ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedReleaseId(release.id);
                      setIsCreatingNew(false);
                    }}
                  >
                    <div class="release-info">
                      <div class="release-name">{release.name}</div>
                      <div class="release-version">v{release.version}</div>
                    </div>
                    <div class="release-meta">
                      <span class="draft-badge">Draft</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Review queue list */}
          <Show when={viewMode() === "review"}>
            <div class="panel-header">
              <h2>Review Queue</h2>
              <span class="count">{pendingSubmissions().length}</span>
            </div>

            <div class="releases-list">
              <Show when={pendingSubmissions().length === 0}>
                <div class="empty-state">
                  <Icon name="shield" size={48} />
                  <p>No pending submissions</p>
                  <span>All caught up!</span>
                </div>
              </Show>

              <For each={pendingSubmissions()}>
                {(submission) => (
                  <div
                    class={`release-item ${selectedSubmissionId() === submission.id ? "selected" : ""}`}
                    onClick={() => setSelectedSubmissionId(submission.id)}
                  >
                    <div class="release-info">
                      <div class="release-name">{submission.asset_name}</div>
                      <div class="release-version">{submission.asset_type}</div>
                    </div>
                    <div class="release-meta">
                      <span class="submission-author">{submission.author}</span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Right panel - Editor or Review */}
        <div class="editor-panel">
          <Show when={viewMode() === "releases"}>
            <Show
              when={selectedReleaseId() || isCreatingNew()}
              fallback={
                <div class="empty-state">
                  <Icon name="rocket" size={64} />
                  <h3>Select a release to edit</h3>
                  <p>Choose a draft release from the left panel or create a new one</p>
                </div>
              }
            >
              <ReleaseEditor
                releaseId={selectedReleaseId()}
                isNew={isCreatingNew()}
                availableAssets={filteredAssets()}
                onSave={handleSaveDraft}
                onPublish={handlePublishRelease}
                onCancel={() => {
                  setIsCreatingNew(false);
                  setSelectedReleaseId(null);
                }}
                searchQuery={searchQuery()}
                setSearchQuery={setSearchQuery}
              />
            </Show>
          </Show>

          <Show when={viewMode() === "review"}>
            <Show
              when={selectedSubmissionId()}
              fallback={
                <div class="empty-state">
                  <Icon name="shield" size={64} />
                  <h3>Select a submission to review</h3>
                  <p>Choose a pending submission from the left panel</p>
                </div>
              }
            >
              <ReviewPanel
                submission={pendingSubmissions().find(s => s.id === selectedSubmissionId())!}
                onApprove={(rejectionReason) => handleReviewSubmission(selectedSubmissionId()!, "approve")}
                onReject={(rejectionReason) => handleReviewSubmission(selectedSubmissionId()!, "reject", rejectionReason)}
                onClose={() => setSelectedSubmissionId(null)}
              />
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
};

// Release Editor Component
type ReleaseEditorProps = {
  releaseId: string | null;
  isNew: boolean;
  availableAssets: Asset[];
  onSave: (data: any) => Promise<void>;
  onPublish: (releaseId: string) => Promise<void>;
  onCancel: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
};

const ReleaseEditor = (props: ReleaseEditorProps) => {
  const actor = createActor(releaseMachine, {
    input: {
      releaseId: props.releaseId || crypto.randomUUID(),
      name: "",
      version: "",
      description: "",
      assetIds: [],
    },
  }).start();

  const [isSaving, setIsSaving] = createSignal(false);
  const [isPublishing, setIsPublishing] = createSignal(false);

  const handleToggleAsset = (assetId: string) => {
    const snapshot = actor.getSnapshot();
    if (snapshot.context.assetIds.includes(assetId)) {
      actor.send({ type: "REMOVE_ASSET", assetId });
    } else {
      actor.send({ type: "ADD_ASSET", assetId });
    }
  };

  const handleSaveDraft = async () => {
    const context = actor.getSnapshot().context;
    setIsSaving(true);
    try {
      await props.onSave({
        name: context.name,
        version: context.version,
        description: context.description || "",
        assetIds: context.assetIds,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!props.releaseId) return;
    setIsPublishing(true);
    try {
      await props.onPublish(props.releaseId);
    } finally {
      setIsPublishing(false);
    }
  };

  const canSave = () => {
    const context = actor.getSnapshot().context;
    return context.name && context.version;
  };

  const canPublish = () => {
    const context = actor.getSnapshot().context;
    return context.name && context.version && context.assetIds.length > 0;
  };

  return (
    <div class="release-editor">
      <div class="editor-header">
        <h2>{props.isNew ? "Create New Release" : "Edit Release"}</h2>
        <div class="editor-actions">
          <button class="btn btn-secondary" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            class="btn btn-secondary"
            onClick={handleSaveDraft}
            disabled={!canSave() || isSaving()}
          >
            <Icon name="save" size={16} />
            {isSaving() ? "Saving..." : "Save Draft"}
          </button>
          <Show when={!props.isNew}>
            <button
              class="btn btn-primary"
              onClick={handlePublish}
              disabled={!canPublish() || isPublishing()}
            >
              <Icon name="rocket" size={16} />
              {isPublishing() ? "Publishing..." : "Publish Release"}
            </button>
          </Show>
        </div>
      </div>

      <div class="editor-content">
        {/* Metadata form */}
        <div class="metadata-section">
          <h3>Release Information</h3>
          <div class="form-row">
            <div class="form-group">
              <label>Name *</label>
              <input
                type="text"
                placeholder="e.g., Winter Collection 2025"
                value={actor.getSnapshot().context.name}
                onInput={(e) =>
                  actor.send({
                    type: "UPDATE_METADATA",
                    name: e.currentTarget.value,
                  })
                }
              />
            </div>
            <div class="form-group">
              <label>Version *</label>
              <input
                type="text"
                placeholder="e.g., 1.0.0"
                value={actor.getSnapshot().context.version}
                onInput={(e) =>
                  actor.send({
                    type: "UPDATE_METADATA",
                    version: e.currentTarget.value,
                  })
                }
              />
            </div>
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea
              placeholder="Describe what's new in this release..."
              value={actor.getSnapshot().context.description || ""}
              onInput={(e) =>
                actor.send({
                  type: "UPDATE_METADATA",
                  description: e.currentTarget.value,
                })
              }
              rows={3}
            />
          </div>
        </div>

        {/* Asset selection */}
        <div class="assets-section">
          <div class="section-header">
            <h3>Assets ({actor.getSnapshot().context.assetIds.length} selected)</h3>
            <div class="search-box">
              <Icon name="search" size={16} />
              <input
                type="text"
                placeholder="Search assets..."
                value={props.searchQuery}
                onInput={(e) => props.setSearchQuery(e.currentTarget.value)}
              />
            </div>
          </div>

          <div class="assets-grid">
            <For each={props.availableAssets}>
              {(asset) => (
                <div
                  class={`asset-card ${
                    actor.getSnapshot().context.assetIds.includes(asset.id) ? "selected" : ""
                  }`}
                  onClick={() => handleToggleAsset(asset.id)}
                >
                  <div class="asset-checkbox">
                    <input
                      type="checkbox"
                      checked={actor.getSnapshot().context.assetIds.includes(asset.id)}
                      onChange={() => handleToggleAsset(asset.id)}
                    />
                  </div>
                  <div class="asset-details">
                    <div class="asset-name">{asset.name}</div>
                    <div class="asset-meta">
                      {asset.type} • {asset.category}
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
};

// Review Panel Component
type ReviewPanelProps = {
  submission: Submission;
  onApprove: (rejectionReason?: string) => Promise<void>;
  onReject: (rejectionReason: string) => Promise<void>;
  onClose: () => void;
};

const ReviewPanel = (props: ReviewPanelProps) => {
  const [rejectionReason, setRejectionReason] = createSignal("");
  const [isApproving, setIsApproving] = createSignal(false);
  const [isRejecting, setIsRejecting] = createSignal(false);

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await props.onApprove();
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason().trim()) {
      alert("Please provide a reason for rejection");
      return;
    }
    setIsRejecting(true);
    try {
      await props.onReject(rejectionReason());
    } finally {
      setIsRejecting(false);
    }
  };

  const thumbnailUrl = () => {
    if (!props.submission.thumbnail_path) return "";
    return `http://localhost:8000${props.submission.thumbnail_path}`;
  };

  return (
    <div class="review-panel">
      <div class="editor-header">
        <h2>Review Submission</h2>
        <div class="editor-actions">
          <button class="btn btn-secondary" onClick={props.onClose}>
            Close
          </button>
          <button
            class="btn btn-danger"
            onClick={handleReject}
            disabled={isRejecting()}
          >
            <Icon name="x-circle" size={16} />
            {isRejecting() ? "Rejecting..." : "Reject"}
          </button>
          <button
            class="btn btn-approve"
            onClick={handleApprove}
            disabled={isApproving()}
          >
            <Icon name="check" size={16} />
            {isApproving() ? "Approving..." : "Approve"}
          </button>
        </div>
      </div>

      <div class="editor-content">
        <div class="review-content">
          {/* Thumbnail */}
          <Show when={thumbnailUrl()}>
            <div class="review-thumbnail">
              <img src={thumbnailUrl()} alt={props.submission.asset_name} />
            </div>
          </Show>

          {/* Submission details */}
          <div class="review-details">
            <div class="detail-row">
              <span class="detail-label">Asset Name</span>
              <span class="detail-value">{props.submission.asset_name}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Type</span>
              <span class="detail-value">{props.submission.asset_type}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Category</span>
              <span class="detail-value">{props.submission.asset_category}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Author</span>
              <span class="detail-value">{props.submission.author}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">License</span>
              <span class="detail-value">{props.submission.license}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Version</span>
              <span class="detail-value">{props.submission.version}</span>
            </div>
            <Show when={props.submission.asset_description}>
              <div class="detail-row">
                <span class="detail-label">Description</span>
                <span class="detail-value">{props.submission.asset_description}</span>
              </div>
            </Show>
            <Show when={props.submission.ai_moderation_result}>
              <div class="detail-row">
                <span class="detail-label">AI Moderation</span>
                <span class="detail-value ai-result">{props.submission.ai_moderation_result}</span>
              </div>
            </Show>
          </div>

          {/* Rejection reason */}
          <div class="rejection-section">
            <label>Rejection Reason (if rejecting)</label>
            <textarea
              placeholder="Provide feedback for the author about why this submission was rejected..."
              value={rejectionReason()}
              onInput={(e) => setRejectionReason(e.currentTarget.value)}
              rows={4}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReleaseManager;
