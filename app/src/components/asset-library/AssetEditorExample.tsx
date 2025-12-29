import { useAssetEditing } from "../../machines/useAssetEditing";
import { useAssetPublishing } from "../../machines/useAssetPublishing";
import { createEffect } from "solid-js";

/**
 * Example showing how editing and publishing machines work together
 * This demonstrates coordinating two state machines for complex workflows
 */
const AssetEditorExample = (props: { assetId: string; assetName: string }) => {
  // Editing machine - handles edit/save cycle
  const editing = useAssetEditing({
    assetId: props.assetId,
    autoSaveEnabled: false, // Manual save for this example
  });

  // Publishing machine - handles submit/review workflow
  const publishing = useAssetPublishing({
    assetId: props.assetId,
    assetName: props.assetName,
  });

  // Coordinate machines: when editing while pending, track it in publishing machine
  createEffect(() => {
    if (publishing.isPending() && editing.isEditing()) {
      publishing.send({ type: "EDIT" });
    }
  });

  return (
    <div class="asset-editor">
      <h3>{props.assetName}</h3>

      {/* Editing State Display */}
      <div class="state-display">
        <div class="state-group">
          <strong>Editing:</strong> {editing.state()}
          {editing.hasUnsavedChanges() && <span class="badge warning">Unsaved</span>}
          {editing.isSaved() && <span class="badge success">✓ Saved</span>}
        </div>
        <div class="state-group">
          <strong>Publishing:</strong> {publishing.state()}
          {publishing.isPending() && <span class="badge pending">Pending Review</span>}
        </div>
      </div>

      {/* Change Tracking */}
      {editing.hasUnsavedChanges() && (
        <div class="changes-info">
          <strong>Changes:</strong>
          {editing.hasMetadataChanges() && <span>Metadata</span>}
          {editing.hasFileChanges() && <span>File</span>}
          {editing.hasThumbnailChanges() && <span>Thumbnail</span>}
        </div>
      )}

      {/* Mock Editor Controls */}
      <div class="editor-controls">
        <button onClick={() => {
          editing.startEdit();
          editing.changeMetadata();
        }}>
          Edit Metadata
        </button>

        <button onClick={() => {
          editing.startEdit();
          editing.changeFile();
        }}>
          Edit File
        </button>

        <button
          onClick={() => {
            editing.save();
            // Simulate async save
            setTimeout(() => editing.saveSuccess(), 1000);
          }}
          disabled={!editing.hasUnsavedChanges()}
        >
          {editing.isSaving() ? "Saving..." : "Save Changes"}
        </button>

        <button
          onClick={editing.cancel}
          disabled={!editing.hasUnsavedChanges()}
        >
          Cancel
        </button>
      </div>

      {/* Publishing Controls */}
      <div class="publishing-controls">
        <button
          onClick={() => {
            publishing.send({ type: "SUBMIT" });
            // Simulate successful submission after a delay
            setTimeout(() => {
              publishing.send({
                type: "SUBMIT_SUCCESS",
                submissionId: crypto.randomUUID()
              });
            }, 1000);
          }}
          disabled={!publishing.canSubmit() || editing.hasUnsavedChanges()}
          title={editing.hasUnsavedChanges() ? "Save changes before submitting" : ""}
        >
          {editing.hasUnsavedChanges() ? "Save Before Submit" : "Submit for Review"}
        </button>

        {publishing.isPending() && publishing.hasEditedAfterSubmit() && (
          <button onClick={() => publishing.send({ type: "RESUBMIT" })}>
            Resubmit Updated Version
          </button>
        )}
      </div>

      {/* Warnings */}
      {publishing.isPending() && editing.hasUnsavedChanges() && (
        <div class="warning-message">
          ⚠️ You're editing an asset that's pending review.
          Changes won't be in the submitted version unless you resubmit.
        </div>
      )}

      {editing.hasError() && (
        <div class="error-message">
          ❌ Save failed: {editing.context().error}
          <button onClick={() => editing.send({ type: "RESET" })}>Dismiss</button>
        </div>
      )}
    </div>
  );
};

export default AssetEditorExample;
