import { For } from "solid-js";
import type { AssetDetailPanelProps } from "../types";
import ActivityTimeline from "./ActivityTimeline";

const AssetDetailPanel = (props: AssetDetailPanelProps) => {
  const asset = () => props.selectedAsset()!;

  return (
    <div class="asset-detail-panel">
      <div class="panel-header">
        <div class="panel-title-wrapper">
          <h2>{asset().name}</h2>
        </div>
        <button class="close-btn" onClick={props.onClose}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="96"
                height="96"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </div>
            {asset().required && (
              <span class="required-badge overlay-badge">Essential</span>
            )}
            {props.isEditingAsset(asset().id) && (
              <span class="editing-badge overlay-badge">Editing</span>
            )}
            {props.isEditingAsset(asset().id) &&
             props.getMachine(asset().id, props.editedAssets().get(asset().id)?.metadata).publishing.isPending() && (
              <span class="pending-badge overlay-badge">Pending Review</span>
            )}
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
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Change Thumbnail
              </button>
            </div>

            <div class="panel-section action-panel blender-panel">
              <p class="action-help-text">
                After saving, changes appear here automatically.
              </p>
              <button
                class="action-btn"
                onClick={() => props.onOpenInBlender(asset().id)}
                title="Open in Blender"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
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
                  Change in <span class="settings-link">Edit → Settings</span>
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

        {props.isEditingAsset(asset().id) && asset().id.includes("_edited_") && (() => {
          const assetMachine = props.getMachine(asset().id, props.editedAssets().get(asset().id)?.metadata);
          const isPending = assetMachine.publishing.isPending();
          const hasEditedAfterSubmit = assetMachine.publishing.hasEditedAfterSubmit();

          return (
            <div class="panel-section action-panel">
              <p class="action-help-text">
                {isPending
                  ? hasEditedAfterSubmit
                    ? "Submit updated version (will replace pending submission)"
                    : "Asset is pending review. You'll be notified when it's approved or rejected."
                  : "Submit for review. Approved assets will be added to the library for others to use."}
              </p>
              <button
                class="action-btn"
                onClick={() => props.onPublishAsset(asset().id)}
                title="Submit asset for publication"
                disabled={isPending && !hasEditedAfterSubmit}
                style={{
                  opacity: (isPending && !hasEditedAfterSubmit) ? "0.5" : "1",
                  cursor: (isPending && !hasEditedAfterSubmit) ? "not-allowed" : "pointer"
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M20 16.5c1.7 0 3-1.3 3-3s-1.3-3-3-3c-.4 0-.8.1-1.2.3-.6-2.3-2.7-4-5.2-4-2 0-3.8 1.1-4.7 2.8C7.6 9.2 6.4 10 5.5 11c-1.4.9-2.3 2.5-2.3 4.2 0 2.8 2.2 5 5 5h11.8"/>
                  <polyline points="16 16 12 12 8 16"/>
                  <line x1="12" y1="12" x2="12" y2="21"/>
                </svg>
                {isPending && !hasEditedAfterSubmit
                  ? "Submitted for Review"
                  : hasEditedAfterSubmit
                  ? "Resubmit Asset"
                  : "Publish Asset"}
              </button>
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
              Delete from downloads
            </button>
          </div>
        )}

        {props.isEditingAsset(asset().id) && asset().id.includes("_edited_") && (
          <>
            <hr class="panel-divider" />
            <div class="panel-section">
              <button
                class="delete-cache-btn"
                onClick={() => props.onRevertToOriginal(asset().id)}
                title="Delete this asset"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
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

            <div class="form-group">
              <label>Notes (optional)</label>
              <textarea
                class="form-textarea"
                value={props.reviewNotes()}
                onInput={(e) => props.setReviewNotes(e.currentTarget.value)}
                placeholder="Add any additional notes..."
                rows={3}
              />
            </div>

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
                  <svg
                    class={`star ${star <= asset().rating ? "filled" : ""}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill={star <= asset().rating ? "currentColor" : "none"}
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
        )}
        {props.isEditingAsset(asset().id) && (
          <button
            class="save-metadata-btn"
            onClick={async () => {
              await props.onSaveMetadata(asset().id);
              props.showMetadataSaveToast("Metadata saved", 2000);
            }}
            title="Save metadata"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Save
          </button>
        )}
      </div>
    </div>
  );
};

export default AssetDetailPanel;
