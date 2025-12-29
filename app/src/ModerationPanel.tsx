import { createSignal, For, createResource } from "solid-js";
import "./ModerationPanel.css";

interface Submission {
  id: string;
  asset_name: string;
  asset_description?: string;
  asset_type: string;
  asset_category: string;
  author: string;
  file_size?: number;
  license: string;
  version: string;
  status: string;
  submitted_at: string;
  ai_moderation_result?: string;
}

const API_URL = "http://localhost:8000";

interface ModerationPanelProps {
  apiKey: string;
}

const ModerationPanel = (props: ModerationPanelProps) => {
  const [selectedSubmission, setSelectedSubmission] = createSignal<Submission | null>(null);
  const [reviewAction, setReviewAction] = createSignal<"approve" | "reject" | null>(null);
  const [rejectionReason, setRejectionReason] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  const fetchPendingSubmissions = async () => {
    const response = await fetch(`${API_URL}/api/submissions/pending`, {
      headers: {
        "X-API-Key": props.apiKey
      }
    });

    if (!response.ok) {
      throw new Error("Failed to fetch submissions");
    }

    return response.json();
  };

  const [submissions, { refetch }] = createResource(fetchPendingSubmissions);

  const handleReview = async () => {
    const submission = selectedSubmission();
    const action = reviewAction();

    if (!submission || !action) return;

    setSubmitting(true);

    try {
      const response = await fetch(
        `${API_URL}/api/submissions/${submission.id}/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": props.apiKey
          },
          body: JSON.stringify({
            action,
            notes: notes(),
            rejection_reason: action === "reject" ? rejectionReason() : undefined
          })
        }
      );

      if (!response.ok) {
        throw new Error("Failed to submit review");
      }

      // Reset form and refetch
      setSelectedSubmission(null);
      setReviewAction(null);
      setRejectionReason("");
      setNotes("");
      refetch();

    } catch (error) {
      console.error("Review failed:", error);
      alert(`Failed to submit review: ${error}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="moderation-panel">
      <div class="moderation-header">
        <h2>Pending Submissions</h2>
        <button class="refresh-btn" onClick={() => refetch()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6"/>
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
            <path d="M3 22v-6h6"/>
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
          </svg>
          Refresh
        </button>
      </div>

      <div class="moderation-content">
        <div class="submissions-list">
          {submissions.loading && <div class="loading">Loading submissions...</div>}
          {submissions.error && <div class="error">Failed to load submissions</div>}
          {submissions() && submissions().length === 0 && (
            <div class="empty">No pending submissions</div>
          )}

          <For each={submissions()}>
            {(submission) => (
              <div
                class={`submission-card ${selectedSubmission()?.id === submission.id ? "selected" : ""}`}
                onClick={() => setSelectedSubmission(submission)}
              >
                <div class="submission-header">
                  <h3>{submission.asset_name}</h3>
                  <span class="submission-type">{submission.asset_type}</span>
                </div>
                <div class="submission-meta">
                  <span>By {submission.author}</span>
                  <span>{new Date(submission.submitted_at).toLocaleDateString()}</span>
                </div>
                {submission.ai_moderation_result && (
                  <div class="ai-badge">AI Reviewed</div>
                )}
              </div>
            )}
          </For>
        </div>

        <div class="submission-detail">
          {selectedSubmission() ? (
            <>
              <div class="detail-header">
                <h2>{selectedSubmission()!.asset_name}</h2>
              </div>

              <div class="detail-section">
                <h3>Details</h3>
                <div class="detail-row">
                  <span class="label">Author:</span>
                  <span>{selectedSubmission()!.author}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Type:</span>
                  <span>{selectedSubmission()!.asset_type}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Category:</span>
                  <span>{selectedSubmission()!.asset_category}</span>
                </div>
                <div class="detail-row">
                  <span class="label">License:</span>
                  <span>{selectedSubmission()!.license}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Version:</span>
                  <span>{selectedSubmission()!.version}</span>
                </div>
                <div class="detail-row">
                  <span class="label">Submitted:</span>
                  <span>{new Date(selectedSubmission()!.submitted_at).toLocaleString()}</span>
                </div>
              </div>

              {selectedSubmission()!.asset_description && (
                <div class="detail-section">
                  <h3>Description</h3>
                  <p>{selectedSubmission()!.asset_description}</p>
                </div>
              )}

              {selectedSubmission()!.ai_moderation_result && (
                <div class="detail-section">
                  <h3>AI Moderation</h3>
                  <pre class="ai-result">
                    {JSON.stringify(JSON.parse(selectedSubmission()!.ai_moderation_result!), null, 2)}
                  </pre>
                </div>
              )}

              <div class="detail-section">
                <h3>Review</h3>

                <div class="review-actions">
                  <button
                    class={`action-btn approve ${reviewAction() === "approve" ? "selected" : ""}`}
                    onClick={() => setReviewAction("approve")}
                  >
                    ✓ Approve
                  </button>
                  <button
                    class={`action-btn reject ${reviewAction() === "reject" ? "selected" : ""}`}
                    onClick={() => setReviewAction("reject")}
                  >
                    ✗ Reject
                  </button>
                </div>

                {reviewAction() === "reject" && (
                  <div class="form-group">
                    <label>Rejection Reason</label>
                    <select
                      class="form-input"
                      value={rejectionReason()}
                      onChange={(e) => setRejectionReason(e.currentTarget.value)}
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
                    value={notes()}
                    onInput={(e) => setNotes(e.currentTarget.value)}
                    placeholder="Add any additional notes..."
                    rows={3}
                  />
                </div>

                <button
                  class="submit-review-btn"
                  onClick={handleReview}
                  disabled={!reviewAction() || submitting() || (reviewAction() === "reject" && !rejectionReason())}
                >
                  {submitting() ? "Submitting..." : "Submit Review"}
                </button>
              </div>
            </>
          ) : (
            <div class="empty-detail">
              Select a submission to review
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModerationPanel;
