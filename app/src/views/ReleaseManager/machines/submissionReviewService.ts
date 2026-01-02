/**
 * Submission Review Service
 * Singleton service for managing submission review state actors
 */

import { createActor, type Actor } from "xstate";
import { submissionReviewMachine } from "./submissionReviewMachine";

type ReviewActor = Actor<typeof submissionReviewMachine>;

const actors = new Map<string, ReviewActor>();

/**
 * Get or create review actor for a submission
 */
export function getReviewActor(submissionId: string): ReviewActor {
  let actor = actors.get(submissionId);

  if (!actor) {
    actor = createActor(submissionReviewMachine, {
      input: { submissionId }
    }).start();

    actors.set(submissionId, actor);
  }

  return actor;
}

/**
 * Remove review actor for a submission (cleanup)
 */
export function removeReviewActor(submissionId: string): void {
  const actor = actors.get(submissionId);
  if (actor) {
    actor.stop();
    actors.delete(submissionId);
  }
}
