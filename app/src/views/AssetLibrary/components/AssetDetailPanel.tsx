import { For, createMemo, createSignal, onCleanup } from "solid-js";
import type { AssetDetailPanelProps } from "../types";
import ActivityTimeline from "./ActivityTimeline";
import Icon from "../../../components/Icon";
import { getEditingActor } from "../machines/assetEditingService";
import { getPublishingActor } from "../machines/assetPublishingService";

const AssetDetailPanel = (props: AssetDetailPanelProps) => {
  const asset = () => props.selectedAsset()!;

  // Subscribe to editing actor for reactive updates
  const [editingSnapshot, setEditingSnapshot] = createSignal<any>(null);
  const [publishingSnapshot, setPublishingSnapshot] = createSignal<any>(null);

  createMemo(() => {
    if (props.isEditingAsset(asset().id)) {
      const editActor = getEditingActor(asset().id);
      const pubActor = getPublishingActor(asset().id, props.editedAssets().get(asset().id)?.metadata);

      setEditingSnapshot(editActor.getSnapshot());
      setPublishingSnapshot(pubActor.getSnapshot());

      const editSub = editActor.subscribe(s => setEditingSnapshot(s));
      const pubSub = pubActor.subscribe(s => setPublishingSnapshot(s));

      onCleanup(() => {
        editSub.unsubscribe();
        pubSub.unsubscribe();
      });
    }
  });

  // Computed values from snapshots
  const hasUnsavedChanges = () => editingSnapshot()?.context.hasUnsavedChanges || false;
  const isPending = () => publishingSnapshot()?.matches("pending") || false;

  return (
    <div class="asset-detail-panel">
      <div class="panel-header">
        <div class="panel-title-wrapper">
          <h2>
            {asset().name}
            {hasUnsavedChanges() && <span> *</span>}
          </h2>
        </div>
        <button class="close-btn" onClick={props.onClose}>
          <Icon name="close" size={24} />
        </button>
      </div>

      <div class="panel-content">
        <div class="panel-thumbnail-container">
          <div class="panel-thumbnail">
            {asset().thumbnail_url ? (
              <img
                src={props.convertToAssetPath(asset().thumbnail_url!, props.thumbnailTimestamps().has(asset().id))}
                alt={asset().name}
                class="panel-thumbnail-image"
                onError={(e) => e.currentTarget.style.display = 'none'}
              />
            ) : null}
            <div class={`placeholder-icon ${asset().thumbnail_url ? 'hidden' : ''}`}>
              <Icon name="image" size={96} />
            </div>
            {asset().required && (
              <span class="required-badge overlay-badge">Essential</span>
            )}
            {props.isEditingAsset(asset().id) && isPending() ? (
              <span class="pending-badge overlay-badge">Pending Review</span>
            ) : props.isEditingAsset(asset().id) ? (
              <span class="editing-badge overlay-badge">Editing</span>
            ) : null}
          </div>
        </div>

        {props.isEditingAsset(asset().id) && (
          <>
            <h3 class="actions-heading">Actions</h3>

            <div class="panel-section action-panel">
              <p class="action-help-text">
                Set a preview image for this asset.
              </p>
              <button
                class="action-btn"
                onClick={() => props.onChangeThumbnail(asset().id)}
                title="Choose thumbnail image"
              >
                <Icon name="image" size={16} />
                Change Thumbnail
              </button>
            </div>

            <div class="panel-section action-panel blender-panel">
              <Icon name="blender" size={70} class="blender-logo" />
              <p class="action-help-text">
                After saving, changes appear here automatically.
              </p>
              <button
                class="action-btn"
                onClick={() => props.onOpenInBlender(asset().id)}
                title="Open in Blender"
              >
                <Icon name="edit" size={16} />
                Edit in Blender
              </button>
            </div>
          </>
        )}

        <div class="panel-section">
          <h3>Details</h3>
          <div class="detail-row">
            <span class="detail-label">Name:</span>
            {props.isEditingAsset(asset().id) ? (
              <input
                type="text"
                class="detail-input"
                value={asset().name}
                onInput={(e) => {
                  const updated = { ...asset(), name: e.currentTarget.value };
                  props.setSelectedAsset(updated);
                  getEditingActor(asset().id).send({ type: "CHANGE_METADATA" });
                }}
              />
            ) : (
              <span class="detail-value">{asset().name}</span>
            )}
          </div>
          <div class="detail-row">
            <span class="detail-label">Author:</span>
            <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 0.25rem;">
              <span class="detail-value">{asset().author}</span>
              {props.isEditingAsset(asset().id) && (
                <span class="detail-hint">
                  Change in{" "}
                  <span class="settings-link" onClick={props.onOpenSettings}>
                    Settings
                  </span>
                </span>
              )}
            </div>
          </div>
          <div class="detail-row">
            <span class="detail-label">Version:</span>
            {props.isEditingAsset(asset().id) ? (
              <input
                type="text"
                class="detail-input"
                value={asset().version}
                placeholder="1.0.0"
                pattern="^\d+\.\d+\.\d+$"
                title="Version must be in semver format: MAJOR.MINOR.PATCH (e.g., 1.0.0)"
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  const updated = { ...asset(), version: value };
                  props.setSelectedAsset(updated);
                  getEditingActor(asset().id).send({ type: "CHANGE_METADATA" });
                }}
                onBlur={(e) => {
                  const value = e.currentTarget.value;
                  const semverRegex = /^\d+\.\d+\.\d+$/;
                  if (!semverRegex.test(value)) {
                    alert("Version must be in semver format: MAJOR.MINOR.PATCH (e.g., 1.0.0)");
                    const original = props.originalEditedMetadata().get(asset().id);
                    if (original) {
                      props.setSelectedAsset({ ...asset(), version: original.version });
                    }
                  }
                }}
              />
            ) : (
              <span class="detail-value">{asset().version}</span>
            )}
          </div>
          <div class="detail-row">
            <span class="detail-label">Type:</span>
            {props.isEditingAsset(asset().id) ? (
              <input
                type="text"
                class="detail-input"
                value={asset().type}
                onInput={(e) => {
                  const updated = { ...asset(), type: e.currentTarget.value };
                  props.setSelectedAsset(updated);
                  getEditingActor(asset().id).send({ type: "CHANGE_METADATA" });
                }}
              />
            ) : (
              <span class="detail-value">{asset().type}</span>
            )}
          </div>
          <div class="detail-row">
            <span class="detail-label">Category:</span>
            {props.isEditingAsset(asset().id) ? (
              <input
                type="text"
                class="detail-input"
                value={asset().category}
                onInput={(e) => {
                  const updated = { ...asset(), category: e.currentTarget.value };
                  props.setSelectedAsset(updated);
                  getEditingActor(asset().id).send({ type: "CHANGE_METADATA" });
                }}
              />
            ) : (
              <span class="detail-value">{asset().category}</span>
            )}
          </div>
          <div class="detail-row">
            <span class="detail-label">License:</span>
            <span class="detail-value">{asset().license}</span>
          </div>
          {!props.isEditingAsset(asset().id) && (
            <>
              <div class="detail-row">
                <span class="detail-label">Published:</span>
                <span class="detail-value">
                  {new Date(asset().publish_date).toLocaleDateString()}
                </span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Downloads:</span>
                <span class="detail-value">{asset().downloads}</span>
              </div>
            </>
          )}
          {asset().file_size && (
            <div class="detail-row">
              <span class="detail-label">Size:</span>
              <span class="detail-value">
                {(asset().file_size! / 1024).toFixed(2)} KB
              </span>
            </div>
          )}
        </div>

        <div class="panel-section">
          <h3>Description</h3>
          {props.isEditingAsset(asset().id) ? (
            <textarea
              class="description-input"
              value={asset().description || ""}
              onInput={(e) => {
                const updated = { ...asset(), description: e.currentTarget.value };
                props.setSelectedAsset(updated);
                getEditingActor(asset().id).send({ type: "CHANGE_METADATA" });
              }}
              rows={4}
              placeholder="Edit description (metadata only - GLB changes must be exported from Blender)"
            />
          ) : (
            asset().description && (
              <p class="description-text">{asset().description}</p>
            )
          )}
        </div>

        {props.isEditingAsset(asset().id) && props.getRecentEvents(asset().id).length > 0 && (
          <ActivityTimeline events={props.getRecentEvents(asset().id)} />
        )}

        {props.isEditingAsset(asset().id) && (() => {
          const editedAsset = props.editedAssets().get(asset().id);
          const hasSavedFile = editedAsset && editedAsset.file_path;

          // Only show publish panel if asset has been saved at least once
          if (!hasSavedFile) {
            return null;
          }

          const pubSnapshot = getPublishingActor(asset().id, editedAsset.metadata).getSnapshot();
          const editSnapshot = getEditingActor(asset().id).getSnapshot();
          const isPending = pubSnapshot.matches("pending");
          const hasEditedAfterSubmit = pubSnapshot.context.editedAfterSubmit;
          const hasUnsaved = editSnapshot.context.hasUnsavedChanges;

          return (
            <div class="panel-section action-panel">
              <p class="action-help-text">
                {isPending
                  ? hasEditedAfterSubmit
                    ? "Submit updated version (will replace pending submission)"
                    : "Asset is pending review. You'll be notified when it's approved or rejected."
                  : hasUnsaved
                  ? "Save your changes first, then you can submit for review."
                  : "Submit for review. Approved assets will be added to the library for others to use."}
              </p>
              <button
                class="action-btn"
                onClick={() => props.onPublishAsset(asset().id)}
                title="Submit asset for publication"
                disabled={(isPending && !hasEditedAfterSubmit) || hasUnsaved}
                style={{
                  opacity: ((isPending && !hasEditedAfterSubmit) || hasUnsaved) ? "0.5" : "1",
                  cursor: ((isPending && !hasEditedAfterSubmit) || hasUnsaved) ? "not-allowed" : "pointer"
                }}
              >
                <Icon name="upload" size={16} />
                {isPending && !hasEditedAfterSubmit
                  ? "Submitted for Review"
                  : hasEditedAfterSubmit
                  ? "Resubmit Asset"
                  : "Publish Asset"}
              </button>

              {isPending && editedAsset.metadata.submission_id && props.onWithdrawSubmission && (
                <button
                  class="action-btn withdraw-btn"
                  onClick={() => props.onWithdrawSubmission!(asset().id)}
                  title="Withdraw this submission from review"
                >
                  <Icon name="x-circle" size={16} />
                  Withdraw Submission
                </button>
              )}
            </div>
          );
        })()}

        {(props.cachedAssets().has(asset().id) && !asset().required && !props.isEditingAsset(asset().id)) && (
          <div class="panel-section">
            <button
              class="delete-cache-btn"
              onClick={() => props.onDeleteCached(asset().id, asset().name)}
              title="Delete from downloads"
            >
              <Icon name="trash" size={16} />
              Delete from downloads
            </button>
          </div>
        )}

        {props.isEditingAsset(asset().id) && (
          <>
            <hr class="panel-divider" />
            <div class="panel-section">
              <button
                class="delete-cache-btn"
                onClick={() => props.onRevertToOriginal(asset().id)}
                title="Delete this asset"
              >
                <Icon name="trash" size={16} />
                Delete
              </button>
            </div>
          </>
        )}

        {props.selectedType() === "pending" && props.appSettings?.moderator_mode && (
          <div class="panel-section">
            <h3>Review Submission</h3>

            <div class="review-actions">
              <button
                class={`action-btn approve ${props.reviewAction() === "approve" ? "selected" : ""}`}
                onClick={() => props.setReviewAction("approve")}
              >
                ✓ Approve
              </button>
              <button
                class={`action-btn reject ${props.reviewAction() === "reject" ? "selected" : ""}`}
                onClick={() => props.setReviewAction("reject")}
              >
                ✗ Reject
              </button>
            </div>

            {props.reviewAction() === "reject" && (
              <div class="form-group">
                <label>Rejection Reason</label>
                <select
                  class="form-input"
                  value={props.rejectionReason()}
                  onChange={(e) => props.setRejectionReason(e.currentTarget.value)}
                >
                  <option value="">Select reason...</option>
                  <option value="quality">Low quality</option>
                  <option value="inappropriate">Inappropriate content</option>
                  <option value="copyright">Copyright violation</option>
                  <option value="incomplete">Incomplete submission</option>
                  <option value="other">Other</option>
                </select>
              </div>
            )}

            <button
              class="submit-review-btn"
              onClick={() => props.onReview(asset().id)}
              disabled={!props.reviewAction() || props.submitting() || (props.reviewAction() === "reject" && !props.rejectionReason())}
            >
              {props.submitting() ? "Submitting..." : "Submit Review"}
            </button>
          </div>
        )}

        {!props.isEditingAsset(asset().id) && props.selectedType() !== "pending" && (
          <div class="panel-section">
            <h3>Rating</h3>
            <div class="asset-rating">
              <For each={[1, 2, 3, 4, 5]}>
                {(star) => (
                  <Icon
                    name="star"
                    size={20}
                    class={`star ${star <= asset().rating ? "filled" : ""}`}
                    style={{ fill: star <= asset().rating ? "currentColor" : "none" }}
                  />
                )}
              </For>
              {asset().rating_count > 0 && (
                <span class="rating-count">({asset().rating_count} ratings)</span>
              )}
            </div>
          </div>
        )}

      </div>

      <div class="panel-footer">
        {!props.isEditingAsset(asset().id) && !props.cachedAssets().has(asset().id) && (
          <button
            class="download-btn-full"
            onClick={() => props.onDownload(asset().id, asset().name)}
            disabled={props.downloading() === asset().id}
          >
            {props.downloading() === asset().id
              ? "Downloading..."
              : "Download Asset"}
          </button>
        )}
        {props.cachedAssets().has(asset().id) && !asset().required && !props.isEditingAsset(asset().id) && (
          <button
            class="edit-btn"
            onClick={() => props.onEditAsset(asset().id)}
            disabled={!props.isLicenseEditable(asset().license)}
            title={
              !props.isLicenseEditable(asset().license)
                ? "This asset's license does not permit modifications"
                : "Create editable copy"
            }
          >
            <Icon name="fork" size={16} />
            Create Copy
          </button>
        )}
        {props.isEditingAsset(asset().id) && (
          <button
            class="save-metadata-btn"
            onClick={async () => {
              await props.onSaveMetadata(asset().id);
              props.showMetadataSaveToast("Metadata saved", 2000);
            }}
            disabled={!hasUnsavedChanges()}
            title={hasUnsavedChanges() ? "Save metadata" : "No changes to save"}
          >
            <Icon name="save" size={16} />
            Save
          </button>
        )}
      </div>
    </div>
  );
};

export default AssetDetailPanel;
