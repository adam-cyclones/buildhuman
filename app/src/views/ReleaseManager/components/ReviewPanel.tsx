/**
 * ReviewPanel Component
 * Displays submission details and provides approve/reject actions
 */

import { createSignal, Show } from "solid-js";
import Icon from "../../../components/Icon";
import { buildThumbnailUrl, isRejectionReasonValid } from "../utils";
import type { ReviewPanelProps } from "../types";

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
    if (!isRejectionReasonValid(rejectionReason())) {
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

  const thumbnailUrl = () => buildThumbnailUrl(props.submission.thumbnail_path);

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

export default ReviewPanel;
