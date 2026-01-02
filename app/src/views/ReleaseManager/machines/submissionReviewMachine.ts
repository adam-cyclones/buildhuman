import { setup, assign } from "xstate";

export type SubmissionReviewContext = {
  submissionId: string;
  releaseId?: string;
  releaseName?: string;
};

export type SubmissionReviewEvent =
  | { type: "APPROVE" }
  | { type: "REJECT" }
  | { type: "ADD_TO_RELEASE"; releaseId: string; releaseName: string }
  | { type: "TIMEOUT" };

export const submissionReviewMachine = setup({
  types: {
    context: {} as SubmissionReviewContext,
    events: {} as SubmissionReviewEvent,
    input: {} as { submissionId: string },
  },
  actions: {
    storeReleaseInfo: assign({
      releaseId: ({ event }) => {
        if (event.type === "ADD_TO_RELEASE") {
          return event.releaseId;
        }
        return undefined;
      },
      releaseName: ({ event }) => {
        if (event.type === "ADD_TO_RELEASE") {
          return event.releaseName;
        }
        return undefined;
      },
    }),
  },
  delays: {
    hangTime: 1500, // 1.5 seconds to show the badge before removing
  },
}).createMachine({
  id: "submissionReview",
  initial: "pending",
  context: ({ input }) => ({
    submissionId: input.submissionId,
  }),
  states: {
    pending: {
      on: {
        APPROVE: "approved",
        REJECT: "rejecting",
      },
    },
    approved: {
      on: {
        ADD_TO_RELEASE: {
          target: "addedToRelease",
          actions: "storeReleaseInfo",
        },
      },
    },
    addedToRelease: {
      after: {
        hangTime: "removed",
      },
    },
    rejecting: {
      after: {
        hangTime: "removed",
      },
    },
    removed: {
      type: "final",
    },
  },
});
