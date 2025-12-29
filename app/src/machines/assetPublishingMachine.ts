import { setup, assign } from "xstate";

/**
 * Asset Publishing State Machine
 * Models the lifecycle of an asset from editing through review to publication
 */

export interface AssetPublishingContext {
  assetId: string;
  assetName: string;
  submissionId?: string;
  error?: string;
  editedAfterSubmit: boolean;
  moderatorNotes?: string;
  rejectionReason?: string;
}

export type AssetPublishingEvent =
  | { type: "SUBMIT" }
  | { type: "SUBMIT_SUCCESS"; submissionId: string }
  | { type: "SUBMIT_FAILURE"; error: string }
  | { type: "EDIT" }
  | { type: "APPROVE"; moderatorNotes?: string }
  | { type: "REJECT"; reason: string; moderatorNotes?: string }
  | { type: "RESUBMIT" }
  | { type: "CANCEL" };

export const assetPublishingMachine = setup({
  types: {
    context: {} as AssetPublishingContext,
    events: {} as AssetPublishingEvent,
  },
  actions: {
    setSubmissionId: assign({
      submissionId: ({ event }) => {
        if (event.type === "SUBMIT_SUCCESS") {
          return event.submissionId;
        }
        return undefined;
      },
    }),
    setError: assign({
      error: ({ event }) => {
        if (event.type === "SUBMIT_FAILURE") {
          return event.error;
        }
        return undefined;
      },
    }),
    markEditedAfterSubmit: assign({
      editedAfterSubmit: true,
    }),
    clearEditedAfterSubmit: assign({
      editedAfterSubmit: false,
    }),
    setRejectionDetails: assign({
      rejectionReason: ({ event }) => {
        if (event.type === "REJECT") {
          return event.reason;
        }
        return undefined;
      },
      moderatorNotes: ({ event }) => {
        if (event.type === "REJECT" || event.type === "APPROVE") {
          return event.moderatorNotes;
        }
        return undefined;
      },
    }),
    setApprovalDetails: assign({
      moderatorNotes: ({ event }) => {
        if (event.type === "APPROVE") {
          return event.moderatorNotes;
        }
        return undefined;
      },
    }),
  },
  guards: {
    hasBeenEdited: ({ context }) => context.editedAfterSubmit,
  },
}).createMachine({
  id: "assetPublishing",
  initial: "editing",
  context: {
    assetId: "",
    assetName: "",
    submissionId: undefined,
    error: undefined,
    editedAfterSubmit: false,
    moderatorNotes: undefined,
    rejectionReason: undefined,
  },
  states: {
    editing: {
      on: {
        SUBMIT: {
          target: "submitting",
        },
      },
    },
    submitting: {
      on: {
        SUBMIT_SUCCESS: {
          target: "pending",
          actions: ["setSubmissionId"],
        },
        SUBMIT_FAILURE: {
          target: "editing",
          actions: ["setError"],
        },
        CANCEL: {
          target: "editing",
        },
      },
    },
    pending: {
      on: {
        EDIT: {
          target: "pendingWithEdits",
          actions: ["markEditedAfterSubmit"],
        },
        APPROVE: {
          target: "approved",
          actions: ["setApprovalDetails"],
        },
        REJECT: {
          target: "rejected",
          actions: ["setRejectionDetails"],
        },
      },
    },
    pendingWithEdits: {
      description: "Asset is pending review but has been edited locally",
      on: {
        RESUBMIT: {
          target: "submitting",
          actions: ["clearEditedAfterSubmit"],
        },
        APPROVE: {
          target: "approved",
          actions: ["setApprovalDetails"],
        },
        REJECT: {
          target: "rejected",
          actions: ["setRejectionDetails"],
        },
      },
    },
    approved: {
      description: "Asset has been approved by moderator and published",
      type: "final",
    },
    rejected: {
      description: "Asset was rejected by moderator",
      on: {
        EDIT: {
          target: "editing",
          actions: ["clearEditedAfterSubmit"],
        },
        RESUBMIT: {
          target: "submitting",
          actions: ["clearEditedAfterSubmit"],
        },
      },
    },
  },
});

export type AssetPublishingMachine = typeof assetPublishingMachine;
