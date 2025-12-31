# Submission Withdrawal Implementation Plan

## Overview

Allow users to withdraw their pending asset submissions with proper authorization checks. Submissions are treated as immutable server-side snapshots (like GitHub PRs), independent of local files.

## Core Principles

1. **Submissions are server-side snapshots**: Files copied to `storage/submissions/` on submit
2. **Local deletion has no effect**: User deleting local files doesn't affect pending submissions
3. **Explicit withdrawal required**: Users must explicitly withdraw via UI action
4. **Status-based rules**: Only pending submissions can be withdrawn by users
5. **Moderator override**: Moderators can withdraw any pending submission

## Architecture

### Submission States

```
┌──────────┐
│  Pending │ ──[user withdraws]──> │ Withdrawn │
└──────────┘                        └───────────┘
     │
     ├──[moderator approves]──> │ Approved │ ──[added to release]──> │ Published │
     │                          └──────────┘                         └───────────┘
     │
     └──[moderator rejects]───> │ Rejected │
                                └──────────┘
```

### Authorization Rules

| Action | Pending | Withdrawn | Approved | Rejected | Published |
|--------|---------|-----------|----------|----------|-----------|
| **User withdraws own** | ✅ | ❌ | ❌ Contact admin | ❌ | ❌ Contact admin |
| **Moderator withdraws any** | ✅ | ❌ | ❌ Contact admin | ❌ | ❌ Contact admin |
| **System cleanup** | After 90 days | Immediate | Never | After 30 days | Never |

## Database Changes

### Add status column to submissions table

```python
# Migration: Add 'withdrawn' status
ALTER TABLE submissions
  MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'withdrawn')
  NOT NULL DEFAULT 'pending';
```

### Add withdrawn_at timestamp

```python
# Migration: Add withdrawn_at column
ALTER TABLE submissions
  ADD COLUMN withdrawn_at TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN withdrawn_by VARCHAR(255) NULL DEFAULT NULL;
```

## API Endpoints

### POST /api/submissions/{submission_id}/withdraw

**Authorization**:
- User must be the submission author OR a moderator
- Submission must be in "pending" status

**Request**:
```json
{
  "reason": "optional withdrawal reason"
}
```

**Response Success (200)**:
```json
{
  "message": "Submission withdrawn successfully",
  "submission_id": "uuid",
  "status": "withdrawn"
}
```

**Response Errors**:
- `401 Unauthorized`: No auth token or invalid token
- `403 Forbidden`: Not author and not moderator
- `404 Not Found`: Submission doesn't exist
- `409 Conflict`: Submission not in pending status

### GET /api/submissions/withdrawn

**Authorization**: User only sees their own withdrawn submissions

**Query params**:
- `limit` (default: 50, max: 100)
- `offset` (default: 0)

**Response**:
```json
{
  "submissions": [...],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

## Frontend Changes

### AssetDetailPanel.tsx

Add "Withdraw Submission" button for pending submissions:

```tsx
{props.isEditingAsset(asset().id) && isPending() && (
  <div class="panel-section action-panel">
    <p class="action-help-text">
      Remove this submission from the review queue. You can resubmit later if needed.
    </p>
    <button
      class="action-btn withdraw-btn"
      onClick={() => props.onWithdrawSubmission(asset().id)}
      title="Withdraw this submission"
    >
      <Icon name="x-circle" size={16} />
      Withdraw Submission
    </button>
  </div>
)}
```

### handlers.ts

Add withdrawal handler:

```typescript
export const createWithdrawSubmissionHandler = (deps: HandlerDependencies) => {
  return async (assetId: string) => {
    const confirmed = confirm(
      "Withdraw this submission from review?\n\n" +
      "This will remove it from the moderation queue. You can resubmit later if needed."
    );

    if (!confirmed) return;

    try {
      const editedAsset = deps.editedAssets().get(assetId);
      if (!editedAsset) return;

      const submissionId = editedAsset.metadata.submission_id;
      if (!submissionId) return;

      await withdrawSubmission({ submissionId });

      deps.showMetadataSaveToast("Submission withdrawn successfully", 3000);

      // Update local state
      const actor = getPublishingActor(assetId, editedAsset.metadata);
      actor.send({ type: "WITHDRAW" });

      // Refresh pending submissions
      await deps.fetchPendingSubmissions();

    } catch (error) {
      console.error("Failed to withdraw submission:", error);
      deps.showMetadataSaveToast(`Failed to withdraw: ${error}`, 5000);
    }
  };
};
```

### client.ts

Add API client function:

```typescript
export const withdrawSubmission = async (params: {
  submissionId: string;
}) => {
  const response = await fetch(
    `${API_URL}/api/submissions/${params.submissionId}/withdraw`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to withdraw submission");
  }

  return response.json();
};
```

### Publishing State Machine Update

Add "withdrawn" state to assetPublishingMachine:

```typescript
states: {
  idle: { /* ... */ },
  pending: {
    on: {
      WITHDRAW: "withdrawn",
      APPROVE: "approved",
      REJECT: "rejected",
      EDIT_METADATA: { actions: "markEditedAfterSubmit" },
      EDIT_FILE: { actions: "markEditedAfterSubmit" }
    }
  },
  withdrawn: {
    type: "final",
    entry: "logWithdrawal"
  },
  approved: { /* ... */ },
  rejected: { /* ... */ }
}
```

## File Cleanup Strategy

### Withdrawn Submissions
- **Immediate cleanup**: Delete GLB and thumbnail files from `storage/submissions/`
- **Database retention**: Keep database record for 90 days with status="withdrawn"
- **User notification**: "Your submission files have been deleted. Resubmitting requires re-uploading."

### Approved Submissions
- **Move to permanent storage**: `storage/assets/{asset_id}.glb`
- **Update database**: Update asset record with file path
- **Keep submission record**: For audit trail

### Rejected Submissions
- **Grace period**: Keep files for 7 days in case of appeal
- **Auto-cleanup**: Delete files after 7 days
- **Database retention**: Keep record for 30 days

## Backend Implementation

### Python FastAPI endpoint

```python
@app.post("/api/submissions/{submission_id}/withdraw")
async def withdraw_submission(
    submission_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # Get submission
    submission = db.query(Submission).filter(
        Submission.id == submission_id
    ).first()

    if not submission:
        raise HTTPException(status_code=404, detail="Submission not found")

    # Check authorization
    is_author = submission.user_id == current_user.id
    is_moderator = current_user.moderator_mode

    if not (is_author or is_moderator):
        raise HTTPException(
            status_code=403,
            detail="Not authorized to withdraw this submission"
        )

    # Check status
    if submission.status != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Cannot withdraw submission with status: {submission.status}"
        )

    # Update status
    submission.status = "withdrawn"
    submission.withdrawn_at = datetime.utcnow()
    submission.withdrawn_by = current_user.id
    db.commit()

    # Delete files
    cleanup_submission_files(submission_id)

    # Create notification
    create_notification(
        user_id=submission.user_id,
        type="withdrawn",
        title="Submission Withdrawn",
        message=f"Your submission '{submission.asset_name}' has been withdrawn",
        submission_id=submission_id
    )

    return {
        "message": "Submission withdrawn successfully",
        "submission_id": submission_id,
        "status": "withdrawn"
    }
```

### Cleanup function

```python
def cleanup_submission_files(submission_id: str):
    """Delete GLB and thumbnail files for a submission"""
    submission_dir = f"{STORAGE_PATH}/submissions"

    # Delete GLB file
    glb_path = f"{submission_dir}/{submission_id}.glb"
    if os.path.exists(glb_path):
        os.remove(glb_path)

    # Delete thumbnail
    thumb_path = f"{submission_dir}/{submission_id}_thumb.png"
    if os.path.exists(thumb_path):
        os.remove(thumb_path)
```

## Testing Checklist

### Unit Tests
- [ ] Test withdrawal authorization (author, moderator, other user)
- [ ] Test withdrawal with different submission statuses
- [ ] Test file cleanup on withdrawal
- [ ] Test publishing machine transitions to withdrawn state

### Integration Tests
- [ ] User withdraws their own pending submission
- [ ] User cannot withdraw approved submission
- [ ] Moderator withdraws any pending submission
- [ ] Files are deleted after withdrawal
- [ ] Notification is created on withdrawal
- [ ] UI updates after withdrawal

### Edge Cases
- [ ] Withdraw submission that doesn't exist (404)
- [ ] Withdraw after moderator already approved (409)
- [ ] Withdraw when files are already deleted (graceful)
- [ ] Concurrent withdrawal attempts (idempotent)

## User Experience Flow

### Successful Withdrawal

1. User clicks "Withdraw Submission" button in detail panel
2. Confirmation dialog appears
3. User confirms withdrawal
4. Loading state shows
5. Success toast: "Submission withdrawn successfully"
6. Asset badge changes from "Pending Review" to "Editing"
7. Publish button reappears
8. Notification appears in bell icon

### Error Handling

**Already reviewed**:
```
"This submission has already been reviewed and cannot be withdrawn.
Please contact an administrator if you need assistance."
```

**Network error**:
```
"Failed to withdraw submission. Please check your connection and try again."
```

## Contact Admin Flow (Future)

For edge cases where user needs to withdraw approved/published assets:

```tsx
<button
  class="contact-admin-btn"
  onClick={() => {
    window.location.href = `mailto:${config.adminEmail}?subject=Asset Withdrawal Request&body=Submission ID: ${submissionId}`;
  }}
>
  Contact Administrator
</button>
```

Environment variable: `VITE_ADMIN_EMAIL=adam@buildhuman.com`

## Migration Path

1. Add database columns (`status`, `withdrawn_at`, `withdrawn_by`)
2. Deploy backend with new endpoint
3. Deploy frontend with withdrawal UI
4. Test with staging environment
5. Deploy to production
6. Monitor for issues

## Success Metrics

- Time to withdraw: < 2 seconds
- User confusion rate: < 5% (measured by support tickets)
- File cleanup success rate: > 99%
- Concurrent operation conflicts: 0
