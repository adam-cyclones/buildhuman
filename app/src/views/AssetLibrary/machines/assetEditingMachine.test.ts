import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { assetEditingMachine } from './assetEditingMachine';

describe('AssetEditingMachine', () => {
  describe('Initial State', () => {
    it('should start in idle state', () => {
      const actor = createActor(assetEditingMachine).start();

      expect(actor.getSnapshot().value).toBe('idle');
      expect(actor.getSnapshot().context.hasUnsavedChanges).toBe(false);
      expect(actor.getSnapshot().context.changes).toEqual({
        metadata: false,
        file: false,
        thumbnail: false,
      });
    });

    it('should have default empty assetId', () => {
      const actor = createActor(assetEditingMachine).start();

      // Machine starts with empty assetId by default
      // assetId is set by the app when creating the machine for a specific asset
      expect(actor.getSnapshot().context.assetId).toBe('');
    });
  });

  describe('Change Events', () => {
    let actor: ReturnType<typeof createActor<typeof assetEditingMachine>>;

    beforeEach(() => {
      actor = createActor(assetEditingMachine, {
        input: { assetId: 'test-asset' }
      }).start();

      // Move to editing state
      actor.send({ type: 'START_EDIT' });
    });

    it('should mark metadata as changed', () => {
      actor.send({ type: 'CHANGE_METADATA' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.hasUnsavedChanges).toBe(true);
      expect(snapshot.context.changes.metadata).toBe(true);
      expect(snapshot.context.changes.file).toBe(false);
      expect(snapshot.context.changes.thumbnail).toBe(false);
    });

    it('should mark file as changed', () => {
      actor.send({ type: 'CHANGE_FILE' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.hasUnsavedChanges).toBe(true);
      expect(snapshot.context.changes.file).toBe(true);
      expect(snapshot.context.changes.metadata).toBe(false);
    });

    it('should mark thumbnail as changed', () => {
      actor.send({ type: 'CHANGE_THUMBNAIL' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.hasUnsavedChanges).toBe(true);
      expect(snapshot.context.changes.thumbnail).toBe(true);
    });

    it('should track multiple changes', () => {
      actor.send({ type: 'CHANGE_METADATA' });
      actor.send({ type: 'CHANGE_THUMBNAIL' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.hasUnsavedChanges).toBe(true);
      expect(snapshot.context.changes.metadata).toBe(true);
      expect(snapshot.context.changes.thumbnail).toBe(true);
      expect(snapshot.context.changes.file).toBe(false);
    });
  });

  describe('Save Flow', () => {
    let actor: ReturnType<typeof createActor<typeof assetEditingMachine>>;

    beforeEach(() => {
      actor = createActor(assetEditingMachine).start();
      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'CHANGE_METADATA' });
    });

    it('should transition to saving state on SAVE', () => {
      actor.send({ type: 'SAVE' });

      expect(actor.getSnapshot().value).toBe('saving');
    });

    it('should transition to idle on SAVE_SUCCESS', () => {
      actor.send({ type: 'SAVE' });
      actor.send({ type: 'SAVE_SUCCESS' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.hasUnsavedChanges).toBe(false);
      expect(snapshot.context.changes).toEqual({
        metadata: false,
        file: false,
        thumbnail: false,
      });
      expect(snapshot.context.lastSavedAt).toBeDefined();
      expect(snapshot.context.error).toBeUndefined();
    });
  });

  describe('Save Failure Flow', () => {
    let actor: ReturnType<typeof createActor<typeof assetEditingMachine>>;

    beforeEach(() => {
      actor = createActor(assetEditingMachine).start();
      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'CHANGE_METADATA' });
      actor.send({ type: 'SAVE' });
    });

    it('should transition to error state on SAVE_FAILURE', () => {
      actor.send({ type: 'SAVE_FAILURE', error: 'Network error' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('error');
      expect(snapshot.context.error).toBe('Network error');
    });

    it('should retry save from error state', () => {
      actor.send({ type: 'SAVE_FAILURE', error: 'Network error' });
      actor.send({ type: 'SAVE' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('saving');
      expect(snapshot.context.error).toBeUndefined();
    });

    it('should reset to editing from error state', () => {
      actor.send({ type: 'SAVE_FAILURE', error: 'Network error' });
      actor.send({ type: 'RESET' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('editing');
      expect(snapshot.context.error).toBeUndefined();
    });
  });

  describe('Cancel Flow', () => {
    it('should cancel changes and return to idle', () => {
      const actor = createActor(assetEditingMachine).start();

      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'CHANGE_METADATA' });
      actor.send({ type: 'CHANGE_THUMBNAIL' });
      actor.send({ type: 'CANCEL' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.hasUnsavedChanges).toBe(false);
      expect(snapshot.context.changes).toEqual({
        metadata: false,
        file: false,
        thumbnail: false,
      });
    });

    it('should cancel from error state', () => {
      const actor = createActor(assetEditingMachine).start();

      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'CHANGE_METADATA' });
      actor.send({ type: 'SAVE' });
      actor.send({ type: 'SAVE_FAILURE', error: 'Network error' });
      actor.send({ type: 'CANCEL' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('idle');
      expect(snapshot.context.error).toBeUndefined();
      expect(snapshot.context.hasUnsavedChanges).toBe(false);
    });
  });

  describe('Changes After Save', () => {
    it('should transition to editing when making changes after save', () => {
      const actor = createActor(assetEditingMachine).start();

      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'CHANGE_METADATA' });
      actor.send({ type: 'SAVE' });
      actor.send({ type: 'SAVE_SUCCESS' });

      // After save, we're in idle state
      expect(actor.getSnapshot().value).toBe('idle');

      // Start editing again and make a change
      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'CHANGE_THUMBNAIL' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('editing');
      expect(snapshot.context.changes.thumbnail).toBe(true);
      expect(snapshot.context.hasUnsavedChanges).toBe(true);
    });
  });

  describe('Auto-Save Guard', () => {
    it('should allow auto-save when enabled (default)', () => {
      const actor = createActor(assetEditingMachine).start();

      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'CHANGE_METADATA' });
      actor.send({ type: 'AUTO_SAVE' });

      // Auto-save is enabled by default, should transition to saving
      expect(actor.getSnapshot().value).toBe('saving');
    });

    // Note: Machine doesn't currently support setting autoSaveEnabled via input
    // If needed in future, would need to add input handling to machine setup
  });

  describe('Edge Cases', () => {
    it('should handle SAVE without any changes', () => {
      const actor = createActor(assetEditingMachine).start();

      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'SAVE' });

      expect(actor.getSnapshot().value).toBe('saving');
    });

    it('should clear error when entering editing state', () => {
      const actor = createActor(assetEditingMachine).start();

      actor.send({ type: 'START_EDIT' });

      const snapshot = actor.getSnapshot();
      expect(snapshot.context.error).toBeUndefined();
    });

    it('should maintain context values throughout state transitions', () => {
      const actor = createActor(assetEditingMachine).start();

      // Initially has default empty assetId
      expect(actor.getSnapshot().context.assetId).toBe('');

      actor.send({ type: 'START_EDIT' });
      actor.send({ type: 'CHANGE_METADATA' });
      actor.send({ type: 'SAVE' });
      actor.send({ type: 'SAVE_SUCCESS' });

      // assetId remains unchanged (empty in this case) throughout transitions
      expect(actor.getSnapshot().context.assetId).toBe('');

      // Note: In real usage, assetId is set when the machine is created
      // via the useAssetEditing hook in the app
    });
  });
});
