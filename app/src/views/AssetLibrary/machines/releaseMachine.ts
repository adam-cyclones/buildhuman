import { setup, assign } from "xstate";

/**
 * Release State Machine
 * Models the lifecycle of a release from draft to published
 */

export interface ReleaseContext {
  releaseId: string;
  name: string;
  version: string;
  description?: string;
  assetIds: string[];
  error?: string;
  publishedAt?: string;
  publishedBy?: string;
}

export type ReleaseEvent =
  | { type: "ADD_ASSET"; assetId: string }
  | { type: "REMOVE_ASSET"; assetId: string }
  | { type: "UPDATE_METADATA"; name?: string; version?: string; description?: string }
  | { type: "PUBLISH" }
  | { type: "PUBLISH_SUCCESS"; publishedAt: string; publishedBy: string }
  | { type: "PUBLISH_FAILURE"; error: string }
  | { type: "SAVE_DRAFT" }
  | { type: "DELETE" };

export const releaseMachine = setup({
  types: {
    context: {} as ReleaseContext,
    events: {} as ReleaseEvent,
    input: {} as Partial<ReleaseContext>,
  },
  actions: {
    addAsset: assign({
      assetIds: ({ context, event }) => {
        if (event.type === "ADD_ASSET" && !context.assetIds.includes(event.assetId)) {
          return [...context.assetIds, event.assetId];
        }
        return context.assetIds;
      },
    }),
    removeAsset: assign({
      assetIds: ({ context, event }) => {
        if (event.type === "REMOVE_ASSET") {
          return context.assetIds.filter(id => id !== event.assetId);
        }
        return context.assetIds;
      },
    }),
    updateMetadata: assign({
      name: ({ context, event }) => {
        if (event.type === "UPDATE_METADATA" && event.name !== undefined) {
          return event.name;
        }
        return context.name;
      },
      version: ({ context, event }) => {
        if (event.type === "UPDATE_METADATA" && event.version !== undefined) {
          return event.version;
        }
        return context.version;
      },
      description: ({ context, event }) => {
        if (event.type === "UPDATE_METADATA" && event.description !== undefined) {
          return event.description;
        }
        return context.description;
      },
    }),
    setPublishSuccess: assign({
      publishedAt: ({ event }) => {
        if (event.type === "PUBLISH_SUCCESS") {
          return event.publishedAt;
        }
        return undefined;
      },
      publishedBy: ({ event }) => {
        if (event.type === "PUBLISH_SUCCESS") {
          return event.publishedBy;
        }
        return undefined;
      },
    }),
    setPublishError: assign({
      error: ({ event }) => {
        if (event.type === "PUBLISH_FAILURE") {
          return event.error;
        }
        return undefined;
      },
    }),
  },
  guards: {
    hasAssets: ({ context }) => context.assetIds.length > 0,
    hasMetadata: ({ context }) => !!context.name && !!context.version,
    canPublish: ({ context }) =>
      context.assetIds.length > 0 && !!context.name && !!context.version,
  },
}).createMachine({
  id: "release",
  initial: "draft",
  context: ({ input }) => ({
    releaseId: input?.releaseId || "",
    name: input?.name || "",
    version: input?.version || "",
    description: input?.description,
    assetIds: input?.assetIds || [],
    error: input?.error,
    publishedAt: input?.publishedAt,
    publishedBy: input?.publishedBy,
  }),
  states: {
    draft: {
      description: "Release is being created and edited",
      on: {
        ADD_ASSET: {
          actions: ["addAsset"],
        },
        REMOVE_ASSET: {
          actions: ["removeAsset"],
        },
        UPDATE_METADATA: {
          actions: ["updateMetadata"],
        },
        PUBLISH: {
          target: "publishing",
          guard: "canPublish",
        },
        SAVE_DRAFT: {
          target: "draft",
        },
        DELETE: {
          target: "deleted",
        },
      },
    },
    publishing: {
      description: "Release is being published",
      on: {
        PUBLISH_SUCCESS: {
          target: "published",
          actions: ["setPublishSuccess"],
        },
        PUBLISH_FAILURE: {
          target: "draft",
          actions: ["setPublishError"],
        },
      },
    },
    published: {
      description: "Release has been published and is visible to users",
      type: "final",
    },
    deleted: {
      description: "Release has been deleted",
      type: "final",
    },
  },
});

export type ReleaseMachine = typeof releaseMachine;
