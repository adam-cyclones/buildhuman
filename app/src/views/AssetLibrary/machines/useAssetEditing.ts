import { createSignal, onCleanup, Accessor } from "solid-js";
import { createActor, SnapshotFrom } from "xstate";
import {
  assetEditingMachine,
  AssetEditingMachine,
  AssetEditingContext,
  AssetEditingEvent
} from "./assetEditingMachine";

export interface UseAssetEditingReturn {
  snapshot: Accessor<SnapshotFrom<AssetEditingMachine>>;
  send: (event: AssetEditingEvent) => void;
  state: Accessor<string>;
  context: Accessor<AssetEditingContext>;

  // Computed state checks
  isIdle: Accessor<boolean>;
  isEditing: Accessor<boolean>;
  isSaving: Accessor<boolean>;
  isSaved: Accessor<boolean>;
  hasError: Accessor<boolean>;
  hasUnsavedChanges: Accessor<boolean>;

  // Change tracking
  hasMetadataChanges: Accessor<boolean>;
  hasFileChanges: Accessor<boolean>;
  hasThumbnailChanges: Accessor<boolean>;

  // Helper methods
  startEdit: () => void;
  changeMetadata: () => void;
  changeFile: () => void;
  changeThumbnail: () => void;
  save: () => void;
  saveSuccess: () => void;
  saveFailure: (error: string) => void;
  cancel: () => void;
}

/**
 * SolidJS hook for managing asset editing state machine
 * Bridges XState actor to Solid reactive signals
 *
 * @param initialContext - Initial context for the state machine
 * @returns State machine snapshot, send function, and computed accessors
 */
export const useAssetEditing = (
  initialContext: Partial<AssetEditingContext> = {}
): UseAssetEditingReturn => {
  // Create XState actor with initial context
  const actor = createActor(assetEditingMachine, {
    input: initialContext,
  }).start();

  // Bridge XState snapshot to a Solid Signal
  const [snapshot, setSnapshot] = createSignal(actor.getSnapshot());

  const sub = actor.subscribe((s) => setSnapshot(s));

  onCleanup(() => {
    sub.unsubscribe();
    actor.stop();
  });

  // Computed accessors
  const state = () => snapshot().value as string;
  const context = () => snapshot().context;

  const isIdle = () => state() === "idle";
  const isEditing = () => state() === "editing";
  const isSaving = () => state() === "saving";
  const isSaved = () => state() === "saved";
  const hasError = () => state() === "error";
  const hasUnsavedChanges = () => context().hasUnsavedChanges;

  const hasMetadataChanges = () => context().changes.metadata || false;
  const hasFileChanges = () => context().changes.file || false;
  const hasThumbnailChanges = () => context().changes.thumbnail || false;

  // Helper methods
  const send = (event: AssetEditingEvent) => actor.send(event);
  const startEdit = () => send({ type: "START_EDIT" });
  const changeMetadata = () => send({ type: "CHANGE_METADATA" });
  const changeFile = () => send({ type: "CHANGE_FILE" });
  const changeThumbnail = () => send({ type: "CHANGE_THUMBNAIL" });
  const save = () => send({ type: "SAVE" });
  const saveSuccess = () => send({ type: "SAVE_SUCCESS" });
  const saveFailure = (error: string) => send({ type: "SAVE_FAILURE", error });
  const cancel = () => send({ type: "CANCEL" });

  return {
    snapshot,
    send,
    state,
    context,
    isIdle,
    isEditing,
    isSaving,
    isSaved,
    hasError,
    hasUnsavedChanges,
    hasMetadataChanges,
    hasFileChanges,
    hasThumbnailChanges,
    startEdit,
    changeMetadata,
    changeFile,
    changeThumbnail,
    save,
    saveSuccess,
    saveFailure,
    cancel,
  };
};
