import { useAssetPublishing } from "../../machines/useAssetPublishing";

/**
 * Example component showing how to use the asset publishing state machine
 * This demonstrates the XState + SolidJS integration pattern
 */
const AssetPublishingExample = (props: { assetId: string; assetName: string }) => {
  const {
    state,
    context,
    send,
    canSubmit,
    canEdit,
    isPending,
    isApproved,
    isRejected,
    hasEditedAfterSubmit,
  } = useAssetPublishing({
    assetId: props.assetId,
    assetName: props.assetName,
  });

  return (
    <div>
      <h3>Asset: {context().assetName}</h3>
      <p>Current State: <strong>{state()}</strong></p>

      <div class="state-indicators">
        {isPending() && <span class="badge pending">Pending Review</span>}
        {hasEditedAfterSubmit() && <span class="badge warning">Edited After Submit</span>}
        {isApproved() && <span class="badge success">Approved</span>}
        {isRejected() && <span class="badge error">Rejected</span>}
      </div>

      <div class="actions">
        {canSubmit() && (
          <button onClick={() => send({ type: "SUBMIT", submissionId: crypto.randomUUID() })}>
            Submit for Review
          </button>
        )}

        {canEdit() && (
          <button onClick={() => send({ type: "EDIT" })}>
            Edit Asset
          </button>
        )}

        {isPending() && hasEditedAfterSubmit() && (
          <button onClick={() => send({ type: "RESUBMIT" })}>
            Resubmit Updated Version
          </button>
        )}
      </div>

      {context().rejectionReason && (
        <div class="rejection-info">
          <p><strong>Rejection Reason:</strong> {context().rejectionReason}</p>
          {context().moderatorNotes && <p>Notes: {context().moderatorNotes}</p>}
        </div>
      )}
    </div>
  );
};

export default AssetPublishingExample;
