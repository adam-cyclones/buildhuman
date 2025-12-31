import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { releaseMachine } from './releaseMachine';

describe('ReleaseMachine', () => {
  describe('Draft state', () => {
    it('starts in draft state', () => {
      const actor = createActor(releaseMachine).start();
      expect(actor.getSnapshot().value).toBe('draft');
    });

    it('adds assets to the release', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: '',
          version: '',
          assetIds: [],
        }
      }).start();

      actor.send({ type: 'ADD_ASSET', assetId: 'asset-1' });
      expect(actor.getSnapshot().context.assetIds).toEqual(['asset-1']);

      actor.send({ type: 'ADD_ASSET', assetId: 'asset-2' });
      expect(actor.getSnapshot().context.assetIds).toEqual(['asset-1', 'asset-2']);
    });

    it('does not add duplicate assets', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: '',
          version: '',
          assetIds: ['asset-1'],
        }
      }).start();

      actor.send({ type: 'ADD_ASSET', assetId: 'asset-1' });
      expect(actor.getSnapshot().context.assetIds).toEqual(['asset-1']);
    });

    it('removes assets from the release', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: '',
          version: '',
          assetIds: ['asset-1', 'asset-2'],
        }
      }).start();

      actor.send({ type: 'REMOVE_ASSET', assetId: 'asset-1' });
      expect(actor.getSnapshot().context.assetIds).toEqual(['asset-2']);
    });

    it('updates metadata', () => {
      const actor = createActor(releaseMachine).start();

      actor.send({
        type: 'UPDATE_METADATA',
        name: 'New Characters Pack',
        version: '1.2.0',
        description: 'Added 5 new character models'
      });

      const context = actor.getSnapshot().context;
      expect(context.name).toBe('New Characters Pack');
      expect(context.version).toBe('1.2.0');
      expect(context.description).toBe('Added 5 new character models');
    });

    it('can save draft and stay in draft state', () => {
      const actor = createActor(releaseMachine).start();

      actor.send({ type: 'SAVE_DRAFT' });
      expect(actor.getSnapshot().value).toBe('draft');
    });

    it('can delete draft release', () => {
      const actor = createActor(releaseMachine).start();

      actor.send({ type: 'DELETE' });
      expect(actor.getSnapshot().value).toBe('deleted');
    });

    it('cannot publish without assets', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: 'Release 1.0',
          version: '1.0.0',
          assetIds: [],
        }
      }).start();

      actor.send({ type: 'PUBLISH' });
      expect(actor.getSnapshot().value).toBe('draft');
    });

    it('cannot publish without metadata', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: '',
          version: '',
          assetIds: ['asset-1'],
        }
      }).start();

      actor.send({ type: 'PUBLISH' });
      expect(actor.getSnapshot().value).toBe('draft');
    });

    it('transitions to publishing when ready', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: 'Release 1.0',
          version: '1.0.0',
          assetIds: ['asset-1'],
        }
      }).start();

      actor.send({ type: 'PUBLISH' });
      expect(actor.getSnapshot().value).toBe('publishing');
    });
  });

  describe('Publishing state', () => {
    it('transitions to published on success', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: 'Release 1.0',
          version: '1.0.0',
          assetIds: ['asset-1'],
        }
      }).start();

      actor.send({ type: 'PUBLISH' });
      actor.send({
        type: 'PUBLISH_SUCCESS',
        publishedAt: '2025-01-01T00:00:00Z',
        publishedBy: 'admin'
      });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('published');
      expect(snapshot.context.publishedAt).toBe('2025-01-01T00:00:00Z');
      expect(snapshot.context.publishedBy).toBe('admin');
    });

    it('returns to draft on failure', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: 'Release 1.0',
          version: '1.0.0',
          assetIds: ['asset-1'],
        }
      }).start();

      actor.send({ type: 'PUBLISH' });
      actor.send({
        type: 'PUBLISH_FAILURE',
        error: 'Network error'
      });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('draft');
      expect(snapshot.context.error).toBe('Network error');
    });
  });

  describe('Published state', () => {
    it('is a final state', () => {
      const actor = createActor(releaseMachine, {
        input: {
          releaseId: 'release-1',
          name: 'Release 1.0',
          version: '1.0.0',
          assetIds: ['asset-1'],
        }
      }).start();

      actor.send({ type: 'PUBLISH' });
      actor.send({
        type: 'PUBLISH_SUCCESS',
        publishedAt: '2025-01-01T00:00:00Z',
        publishedBy: 'admin'
      });

      const snapshot = actor.getSnapshot();
      expect(snapshot.status).toBe('done');
    });
  });

  describe('Complex workflows', () => {
    it('allows building a release step by step', () => {
      const actor = createActor(releaseMachine).start();

      // Step 1: Add metadata
      actor.send({
        type: 'UPDATE_METADATA',
        name: 'Winter Update',
        version: '2.0.0',
        description: 'New winter-themed assets'
      });

      // Step 2: Add assets
      actor.send({ type: 'ADD_ASSET', assetId: 'snowman' });
      actor.send({ type: 'ADD_ASSET', assetId: 'winter-tree' });
      actor.send({ type: 'ADD_ASSET', assetId: 'ice-sculpture' });

      // Step 3: Remove one asset
      actor.send({ type: 'REMOVE_ASSET', assetId: 'snowman' });

      // Step 4: Save draft
      actor.send({ type: 'SAVE_DRAFT' });
      expect(actor.getSnapshot().value).toBe('draft');

      // Step 5: Publish
      actor.send({ type: 'PUBLISH' });
      expect(actor.getSnapshot().value).toBe('publishing');

      actor.send({
        type: 'PUBLISH_SUCCESS',
        publishedAt: '2025-01-15T12:00:00Z',
        publishedBy: 'moderator'
      });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('published');
      expect(snapshot.context.assetIds).toEqual(['winter-tree', 'ice-sculpture']);
      expect(snapshot.context.name).toBe('Winter Update');
    });
  });
});
