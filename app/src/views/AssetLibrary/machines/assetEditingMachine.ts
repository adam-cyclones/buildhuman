import { setup, assign } from "xstate";

/**
 * Asset Editing State Machine
 * Manages the editing lifecycle: changes, saves, and coordination with publishing
 */

export interface AssetEditingContext {
  assetId: string;
  hasUnsavedChanges: boolean;
  lastSavedAt?: number;
  error?: string;
  changes: {
    metadata?: boolean;
    file?: boolean;
    thumbnail?: boolean;
  };
  autoSaveEnabled: boolean;
}

export type AssetEditingEvent =
  | { type: "START_EDIT" }
  | { type: "CHANGE_METADATA" }
  | { type: "CHANGE_FILE" }
  | { type: "CHANGE_THUMBNAIL" }
  | { type: "SAVE" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_FAILURE"; error: string }
  | { type: "CANCEL" }
  | { type: "AUTO_SAVE" }
  | { type: "RESET" };

export const assetEditingMachine = setup({
  types: {
    context: {} as AssetEditingContext,
    events: {} as AssetEditingEvent,
  },
  actions: {
    markMetadataChanged: assign({
      hasUnsavedChanges: true,
      changes: ({ context }) => ({
        ...context.changes,
        metadata: true,
      }),
    }),
    markFileChanged: assign({
      hasUnsavedChanges: true,
      changes: ({ context }) => ({
        ...context.changes,
        file: true,
      }),
    }),
    markThumbnailChanged: assign({
      hasUnsavedChanges: true,
      changes: ({ context }) => ({
        ...context.changes,
        thumbnail: true,
      }),
    }),
    clearChanges: assign({
      hasUnsavedChanges: false,
      changes: {
        metadata: false,
        file: false,
        thumbnail: false,
      },
      lastSavedAt: Date.now(),
    }),
    setError: assign({
      error: ({ event }) => {
        if (event.type === "SAVE_FAILURE") {
          return event.error;
        }
        return undefined;
      },
    }),
    clearError: assign({
      error: undefined,
    }),
  },
  guards: {
    hasUnsavedChanges: ({ context }) => context.hasUnsavedChanges,
    autoSaveEnabled: ({ context }) => context.autoSaveEnabled,
  },
}).createMachine({
  id: "assetEditing",
  initial: "idle",
  context: {
    assetId: "",
    hasUnsavedChanges: false,
    lastSavedAt: undefined,
    error: undefined,
    changes: {
      metadata: false,
      file: false,
      thumbnail: false,
    },
    autoSaveEnabled: true,
  },
  states: {
    idle: {
      description: "Not currently editing",
      on: {
        START_EDIT: {
          target: "editing",
          actions: ["clearError"],
        },
      },
    },
    editing: {
      description: "Has unsaved changes",
      on: {
        CHANGE_METADATA: {
          actions: ["markMetadataChanged"],
        },
        CHANGE_FILE: {
          actions: ["markFileChanged"],
        },
        CHANGE_THUMBNAIL: {
          actions: ["markThumbnailChanged"],
        },
        SAVE: {
          target: "saving",
        },
        AUTO_SAVE: {
          target: "saving",
          guard: { type: "autoSaveEnabled" },
        },
        CANCEL: {
          target: "idle",
          actions: ["clearChanges"],
        },
      },
    },
    saving: {
      description: "Save in progress",
      on: {
        SAVE_SUCCESS: {
          target: "idle",
          actions: ["clearChanges", "clearError"],
        },
        SAVE_FAILURE: {
          target: "error",
          actions: ["setError"],
        },
      },
    },
    error: {
      description: "Save failed",
      on: {
        SAVE: {
          target: "saving",
          actions: ["clearError"],
        },
        CANCEL: {
          target: "idle",
          actions: ["clearChanges", "clearError"],
        },
        RESET: {
          target: "editing",
          actions: ["clearError"],
        },
      },
    },
  },
});

export type AssetEditingMachine = typeof assetEditingMachine;
