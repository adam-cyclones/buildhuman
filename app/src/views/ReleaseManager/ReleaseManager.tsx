import { For, Show, createSignal, createResource } from "solid-js";
import Icon from "../../components/Icon";
import { formatBytes, getStatusColor, getAssetTypeIcon, getAssetTypeColor, buildThumbnailUrl, getNextVersionString } from "./utils";
import type { ReleaseManagerProps, ExtendedRelease } from "./types";
import type { Submission } from "../AssetLibrary/types";
import { fetchPendingSubmissions } from "./client";
import "./ReleaseManager.css";

const ReleaseManager = (props: ReleaseManagerProps) => {
  const [isCreateOpen, setIsCreateOpen] = createSignal(false);
  const [newReleaseName, setNewReleaseName] = createSignal("");
  const [newReleaseVersion, setNewReleaseVersion] = createSignal("");
  const [newReleaseBranch, setNewReleaseBranch] = createSignal("production");
  const [newReleaseDescription, setNewReleaseDescription] = createSignal("");
  const [selectedSubmission, setSelectedSubmission] = createSignal<Submission | null>(null);
  const [approvedSubmissions, setApprovedSubmissions] = createSignal<Set<string>>(new Set());
  const [selectedReleaseForSubmission, setSelectedReleaseForSubmission] = createSignal<{[key: string]: string}>({});
  const [galleryOpen, setGalleryOpen] = createSignal(false);
  const [gallerySubmission, setGallerySubmission] = createSignal<Submission | null>(null);

  // Fetch pending submissions
  const [pendingSubmissions] = createResource(() => fetchPendingSubmissions(props.appSettings));

  const handleCreateRelease = (e: Event) => {
    e.preventDefault();
    const release: ExtendedRelease = {
      id: Date.now().toString(),
      version: newReleaseVersion(),
      name: newReleaseName(),
      description: newReleaseDescription(),
      createdAt: new Date(),
      status: "draft",
      author: props.appSettings?.author_name || "current.user",
      branch: newReleaseBranch(),
      assets: [],
    };

    // TODO: Call API to create release
    console.log("Creating release:", release);

    setIsCreateOpen(false);
    setNewReleaseName("");
    setNewReleaseVersion("");
    setNewReleaseBranch("production");
    setNewReleaseDescription("");
  };

  const handleFileSelect = (releaseId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;

    // TODO: Implement file upload with commit message dialog
    console.log("Files selected for release:", releaseId, files);
  };

  const handleDeleteAsset = (releaseId: string, assetId: string) => {
    // TODO: Implement asset deletion
    console.log("Delete asset:", assetId, "from release:", releaseId);
  };

  const handleDeploy = (releaseId: string, targetStatus: "staging" | "production") => {
    // TODO: Implement deployment
    console.log("Deploy release:", releaseId, "to:", targetStatus);
  };

  const handleApproveSubmission = (submissionId: string) => {
    // TODO: Implement approval - mark as approved
    console.log("Approve submission:", submissionId);
    setApprovedSubmissions(prev => new Set(prev).add(submissionId));
    // Auto-select the submission to show release options
    const submission = pendingSubmissions()?.find((s: Submission) => s.id === submissionId);
    if (submission) {
      setSelectedSubmission(submission);
    }
  };

  const handleAddToRelease = (submissionId: string, releaseId: string) => {
    // TODO: Add approved asset to selected release
    console.log("Add submission:", submissionId, "to release:", releaseId);
    // Remove from approved list after adding to release
    setApprovedSubmissions(prev => {
      const next = new Set(prev);
      next.delete(submissionId);
      return next;
    });
    setSelectedSubmission(null);
  };

  const handleRejectSubmission = (submissionId: string) => {
    // TODO: Implement rejection with reason dialog
    console.log("Reject submission:", submissionId);
    setSelectedSubmission(null);
  };

  const getDraftReleases = () => {
    return mockReleases().filter(r => r.status === "draft");
  };

  // Mock data for demonstration - replace with actual API data
  const mockReleases = (): ExtendedRelease[] => [
    {
      id: "1",
      version: "10-25.R1",
      name: "Halloween Pack",
      description: "Spooky themed 3D assets including characters, props, and environments for Halloween season event.",
      createdAt: new Date("2025-10-15"),
      status: "production",
      author: "maya.artist",
      branch: "main",
      deployedAt: new Date("2025-10-20"),
      assets: [
        {
          id: "a1",
          name: "pumpkin_jack.glb",
          type: "models",
          category: "characters",
          author: "maya.artist",
          rating: 4.5,
          rating_count: 10,
          license: "CC-BY",
          publish_date: "2025-10-15",
          downloads: 50,
          version: "1.0",
          required: false,
          size: 12458921,
          uploadedAt: new Date("2025-10-15"),
          commitMessage: "Added animated jack-o-lantern character",
          folder: "characters",
        },
      ],
    },
    {
      id: "2",
      version: "12-25.R1",
      name: "Winter Collection",
      description: "Upcoming winter assets release - currently collecting assets for review.",
      createdAt: new Date("2025-12-01"),
      status: "draft",
      author: props.appSettings?.author_name || "current.user",
      branch: "main",
      assets: [],
    },
    {
      id: "3",
      version: "12-25.R2",
      name: "Fantasy Weapons Pack",
      description: "Major release featuring legendary fantasy weapons and armor sets.",
      createdAt: new Date("2025-12-02"),
      status: "draft",
      author: props.appSettings?.author_name || "current.user",
      branch: "main",
      assets: [],
    },
  ];

  return (
    <div class="release-manager">
      <div class="release-manager-header">
        <div class="header-content">
          <h1>Release Manager</h1>
          <p class="header-subtitle">Review submissions and add them to releases</p>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary" onClick={() => {
            const versions = mockReleases().map(r => r.version);
            const nextVersion = getNextVersionString(versions);
            setNewReleaseVersion(nextVersion);
            setIsCreateOpen(true);
          }}>
            <Icon name="plus" size={16} />
            Create Release
          </button>
        </div>
      </div>

      <div class="release-manager-body">
        {/* Review Sidebar - Always Visible */}
        <div class="review-sidebar">
          <div class="review-sidebar-header">
            <div class="sidebar-title">
              <Icon name="shield" size={20} />
              <h3>Review Queue</h3>
            </div>
            <Show when={pendingSubmissions() && pendingSubmissions()!.length > 0}>
              <span class="badge-count">{pendingSubmissions()!.length}</span>
            </Show>
          </div>

          <div class="review-sidebar-content">
            <Show
              when={pendingSubmissions() && pendingSubmissions()!.length > 0}
              fallback={
                <div class="empty-review-state">
                  <Icon name="check" size={48} />
                  <p>All caught up!</p>
                  <span>No pending submissions to review</span>
                </div>
              }
            >
              <For each={pendingSubmissions() || []}>
                {(submission) => (
                  <div
                    class={`review-card ${selectedSubmission()?.id === submission.id ? "selected" : ""}`}
                    onClick={() => setSelectedSubmission(submission)}
                  >
                    <div class="review-card-header">
                      <h4>{submission.asset_name}</h4>
                      <Show
                        when={!approvedSubmissions().has(submission.id)}
                        fallback={
                          <div class="approved-badge">
                            <Icon name="check" size={12} />
                            <span>Approved</span>
                          </div>
                        }
                      >
                        <div class="review-quick-actions-corner">
                          <button
                            class="btn-icon-circle btn-icon-approve"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApproveSubmission(submission.id);
                            }}
                            title="Approve Asset"
                          >
                            <Icon name="check" size={16} />
                          </button>
                          <button
                            class="btn-icon-circle btn-icon-reject"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRejectSubmission(submission.id);
                            }}
                            title="Reject"
                          >
                            <Icon name="close" size={16} />
                          </button>
                        </div>
                      </Show>
                    </div>

                    <div class="review-card-meta">
                      <div class="meta-row">
                        <Icon name="user" size={14} />
                        <span>{submission.author}</span>
                      </div>
                      <div class="meta-row">
                        <Icon name="folder" size={14} />
                        <span>{submission.asset_category}</span>
                      </div>
                      <Show when={submission.file_size}>
                        <div class="meta-row">
                          <Icon name="box" size={14} />
                          <span>{formatBytes(submission.file_size || 0)}</span>
                        </div>
                      </Show>
                    </div>

                    <Show when={submission.thumbnail_path}>
                      <div
                        class="review-thumbnail-small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setGallerySubmission(submission);
                          setGalleryOpen(true);
                        }}
                      >
                        <img
                          src={buildThumbnailUrl(submission.thumbnail_path)}
                          alt={submission.asset_name}
                        />
                      </div>
                    </Show>

                    <Show when={submission.asset_description}>
                      <p class="review-description">{submission.asset_description}</p>
                    </Show>

                    <Show when={selectedSubmission()?.id === submission.id && approvedSubmissions().has(submission.id)}>
                      <div class="review-actions">
                        <div class="review-action-group">
                          <label class="action-label">Add to Draft Release:</label>
                          <div class="release-radio-group">
                            <For each={getDraftReleases()}>
                              {(release) => (
                                <label
                                  class={`release-radio-option ${selectedReleaseForSubmission()[submission.id] === release.id ? "selected" : ""}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedReleaseForSubmission({
                                      ...selectedReleaseForSubmission(),
                                      [submission.id]: release.id
                                    });
                                    // Auto-submit when selection is made
                                    handleAddToRelease(submission.id, release.id);
                                  }}
                                >
                                  <div class="release-radio-check">
                                    <Show when={selectedReleaseForSubmission()[submission.id] === release.id}>
                                      <Icon name="check" size={16} />
                                    </Show>
                                  </div>
                                  <div class="release-radio-content">
                                    <span class="release-version">{release.version}</span>
                                    <span class="release-name">{release.name}</span>
                                  </div>
                                </label>
                              )}
                            </For>
                          </div>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        {/* Create Release Dialog */}
        <Show when={isCreateOpen()}>
          <div class="dialog-overlay" onClick={() => setIsCreateOpen(false)}>
            <div class="dialog-content" onClick={(e) => e.stopPropagation()}>
              <div class="dialog-header">
                <h2>Create New Release</h2>
                <p>Add version information and release notes</p>
              </div>
              <form onSubmit={handleCreateRelease} class="dialog-form">
                <div class="form-group">
                  <label for="version">Version</label>
                  <input
                    id="version"
                    type="text"
                    placeholder="01-26.R1"
                    value={newReleaseVersion()}
                    readonly
                    required
                  />
                </div>
                <div class="form-group">
                  <label for="name">Release Name</label>
                  <input
                    id="name"
                    type="text"
                    placeholder="Season 3 Assets"
                    value={newReleaseName()}
                    onInput={(e) => setNewReleaseName(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="form-group">
                  <label for="environment">Environment</label>
                  <input
                    id="environment"
                    type="text"
                    placeholder="production"
                    value={newReleaseBranch()}
                    readonly
                    required
                  />
                </div>
                <div class="form-group">
                  <label for="description">Description</label>
                  <textarea
                    id="description"
                    placeholder="Describe what assets are included in this release..."
                    rows={4}
                    value={newReleaseDescription()}
                    onInput={(e) => setNewReleaseDescription(e.currentTarget.value)}
                    required
                  />
                </div>
                <div class="dialog-actions">
                  <button type="button" class="btn btn-secondary" onClick={() => setIsCreateOpen(false)}>
                    Cancel
                  </button>
                  <button type="submit" class="btn btn-primary">
                    Create Release
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Show>

        {/* Releases List */}
        <div class="releases-container">
          <For each={mockReleases()}>
            {(release) => (
              <div class="release-card">
                {/* Release Header */}
                <div class="release-card-header">
                  <div class="release-header-content">
                    <div class="release-title-row">
                      <h3 class="release-version">{release.version}</h3>
                      <span class={`status-badge ${getStatusColor(release.status)}`}>
                        {release.status}
                      </span>
                    </div>
                    <p class="release-name">{release.name}</p>
                    <p class="release-description">{release.description}</p>
                  </div>
                  <Show when={release.status === "draft"}>
                    <button
                      class="btn btn-secondary btn-sm"
                      onClick={() => handleDeploy(release.id, "staging")}
                    >
                      <Icon name="upload" size={16} />
                      Deploy to Staging
                    </button>
                  </Show>
                  <Show when={release.status === "staging"}>
                    <button
                      class="btn btn-primary btn-sm"
                      onClick={() => handleDeploy(release.id, "production")}
                    >
                      <Icon name="upload" size={16} />
                      Deploy to Production
                    </button>
                  </Show>
                </div>

                {/* Release Metadata */}
                <div class="release-metadata">
                  <div class="metadata-item">
                    <Icon name="calendar" size={16} />
                    {release.createdAt.toLocaleDateString()}
                  </div>
                  <div class="metadata-item">
                    <Icon name="user" size={16} />
                    {release.author}
                  </div>
                  <div class="metadata-item">
                    <Icon name="git-branch" size={16} />
                    {release.branch}
                  </div>
                  <div class="metadata-item">
                    <Icon name="box" size={16} />
                    {release.assets.length} {release.assets.length === 1 ? "asset" : "assets"}
                  </div>
                  <Show when={release.deployedAt}>
                    <div class="metadata-item">
                      <Icon name="upload" size={16} />
                      Deployed {release.deployedAt?.toLocaleDateString()}
                    </div>
                  </Show>
                </div>

                {/* Assets Section */}
                <div class="release-assets-section">
                  <div class="assets-section-header">
                    <h4>Release Assets</h4>
                    <label for={`upload-${release.id}`}>
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        onClick={() => document.getElementById(`upload-${release.id}`)?.click()}
                      >
                        <Icon name="upload" size={16} />
                        Upload Assets
                      </button>
                      <input
                        id={`upload-${release.id}`}
                        type="file"
                        multiple
                        accept=".glb,.gltf,.fbx,.obj,.blend,.png,.jpg,.jpeg"
                        class="file-input-hidden"
                        onChange={(e) => handleFileSelect(release.id, e.currentTarget.files)}
                      />
                    </label>
                  </div>

                  <Show
                    when={release.assets.length > 0}
                    fallback={
                      <div class="empty-assets-state">
                        <Icon name="box" size={48} />
                        <p>No assets uploaded yet</p>
                        <span>Upload 3D models, textures, animations, or drag approved assets from the review queue</span>
                      </div>
                    }
                  >
                    <div class="assets-grid">
                      <For each={release.assets}>
                        {(asset) => (
                          <div class="asset-card-grid">
                            {/* Asset Thumbnail */}
                            <div class="asset-thumbnail">
                              <img
                                src={asset.thumbnail || "/placeholder.svg"}
                                alt={asset.name}
                              />
                              <div class="asset-actions-overlay">
                                <button class="asset-action-btn" title="Download">
                                  <Icon name="download" size={16} />
                                </button>
                                <button
                                  class="asset-action-btn asset-action-delete"
                                  title="Delete"
                                  onClick={() => handleDeleteAsset(release.id, asset.id)}
                                >
                                  <Icon name="trash" size={16} />
                                </button>
                              </div>
                              <div class="asset-type-badge">
                                <Icon name={getAssetTypeIcon(asset.type)} size={14} />
                                <span class={getAssetTypeColor(asset.type)}>{asset.type}</span>
                              </div>
                            </div>

                            {/* Asset Info */}
                            <div class="asset-info-grid">
                              <p class="asset-name-grid" title={asset.name}>
                                {asset.name}
                              </p>
                              <div class="asset-meta-grid">
                                <span>{formatBytes(asset.size || 0)}</span>
                                <Show when={asset.folder}>
                                  <span>•</span>
                                  <span class="asset-folder">{asset.folder}</span>
                                </Show>
                              </div>
                              <Show when={asset.commitMessage}>
                                <p class="asset-commit-message" title={asset.commitMessage}>
                                  {asset.commitMessage}
                                </p>
                              </Show>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>

      {/* Gallery Dialog */}
      <Show when={galleryOpen()}>
        <div class="dialog-overlay" onClick={() => setGalleryOpen(false)}>
          <div class="gallery-dialog" onClick={(e) => e.stopPropagation()}>
            <div class="gallery-header">
              <h2>{gallerySubmission()?.asset_name}</h2>
              <button
                class="btn btn-sm btn-secondary"
                onClick={() => setGalleryOpen(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div class="gallery-content">
              <Show when={gallerySubmission()?.thumbnail_path}>
                <img
                  src={buildThumbnailUrl(gallerySubmission()!.thumbnail_path)}
                  alt={gallerySubmission()?.asset_name}
                  class="gallery-image"
                />
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default ReleaseManager;
