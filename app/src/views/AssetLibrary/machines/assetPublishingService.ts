/**
 * Asset Publishing Service
 * Singleton service for managing publishing state actors
 */

import { createActor, type Actor } from "xstate";
import { assetPublishingMachine, type AssetPublishingMachine } from "./assetPublishingMachine";

type PublishingActor = Actor<AssetPublishingMachine>;

const actors = new Map<string, PublishingActor>();

/**
 * Get or create publishing actor for an asset
 */
export function getPublishingActor(assetId: string, metadata?: any): PublishingActor {
  let actor = actors.get(assetId);

  if (!actor) {
    actor = createActor(assetPublishingMachine, {
      input: {
        assetId,
        assetName: metadata?.name || "",
        submissionId: metadata?.submission_id,
        editedAfterSubmit: metadata?.last_edited_after_publish || false
      }
    }).start();

    actors.set(assetId, actor);

    // Move to correct state based on metadata
    if (metadata?.submission_status === "pending") {
      actor.send({ type: "SUBMIT" });
      actor.send({ type: "SUBMIT_SUCCESS", submissionId: metadata.submission_id });

      if (metadata.last_edited_after_publish) {
        actor.send({ type: "EDIT" });
      }
    }
  }

  return actor;
}

/**
 * Remove publishing actor for an asset (cleanup)
 */
export function removePublishingActor(assetId: string): void {
  const actor = actors.get(assetId);
  if (actor) {
    actor.stop();
    actors.delete(assetId);
  }
}
