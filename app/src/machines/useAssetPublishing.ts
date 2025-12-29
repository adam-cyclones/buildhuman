import { createSignal, onCleanup, Accessor } from "solid-js";
import { createActor, SnapshotFrom } from "xstate";
import {
  assetPublishingMachine,
  AssetPublishingMachine,
  AssetPublishingContext,
  AssetPublishingEvent
} from "./assetPublishingMachine";

export interface UseAssetPublishingReturn {
  snapshot: Accessor<SnapshotFrom<AssetPublishingMachine>>;
  send: (event: AssetPublishingEvent) => void;
  state: Accessor<string>;
  context: Accessor<AssetPublishingContext>;
  canSubmit: Accessor<boolean>;
  canEdit: Accessor<boolean>;
  isPending: Accessor<boolean>;
  isApproved: Accessor<boolean>;
  isRejected: Accessor<boolean>;
  hasEditedAfterSubmit: Accessor<boolean>;
}

/**
 * SolidJS hook for managing asset publishing state machine
 * Bridges XState actor to Solid reactive signals
 *
 * @param initialContext - Initial context for the state machine
 * @returns State machine snapshot, send function, and computed accessors
 */
export const useAssetPublishing = (
  initialContext: Partial<AssetPublishingContext> = {}
): UseAssetPublishingReturn => {
  // Create XState actor with initial context
  const actor = createActor(assetPublishingMachine, {
    input: initialContext,
  }).start();

  // Bridge XState snapshot to a Solid Signal
  const [snapshot, setSnapshot] = createSignal(actor.getSnapshot());

  const sub = actor.subscribe((s) => setSnapshot(s));

  onCleanup(() => {
    sub.unsubscribe();
    actor.stop();
  });

  // Computed accessors for common state checks
  const state = () => snapshot().value as string;
  const context = () => snapshot().context;
  const canSubmit = () => state() === "editing" || state() === "rejected";
  const canEdit = () => !["submitting", "approved"].includes(state());
  const isPending = () => state() === "pending" || state() === "pendingWithEdits";
  const isApproved = () => state() === "approved";
  const isRejected = () => state() === "rejected";
  const hasEditedAfterSubmit = () => context().editedAfterSubmit;

  return {
    snapshot,
    send: (event) => actor.send(event),
    state,
    context,
    canSubmit,
    canEdit,
    isPending,
    isApproved,
    isRejected,
    hasEditedAfterSubmit,
  };
};
