/**
 * Asset Editing Service
 * Singleton service for managing editing state actors
 */

import { createActor, type Actor } from "xstate";
import { assetEditingMachine, type AssetEditingMachine } from "./assetEditingMachine";

type EditingActor = Actor<AssetEditingMachine>;

const actors = new Map<string, EditingActor>();

/**
 * Get or create editing actor for an asset
 */
export function getEditingActor(assetId: string): EditingActor {
  let actor = actors.get(assetId);

  if (!actor) {
    actor = createActor(assetEditingMachine, {
      input: {
        assetId,
        hasUnsavedChanges: false,
        changes: { metadata: false, file: false, thumbnail: false }
      }
    }).start();

    actors.set(assetId, actor);

    // Start editing state for edited assets
    if (assetId.includes("_edited_") || assetId.includes("_editing")) {
      actor.send({ type: "START_EDIT" });
    }
  }

  return actor;
}

/**
 * Remove editing actor for an asset (cleanup)
 */
export function removeEditingActor(assetId: string): void {
  const actor = actors.get(assetId);
  if (actor) {
    actor.stop();
    actors.delete(assetId);
  }
}
