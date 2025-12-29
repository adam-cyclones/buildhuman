import { Accessor, Setter } from "solid-js";
import { invoke } from "@tauri-apps/api/core";

export interface AssetEvent {
  type: string;
  timestamp: number;
  data?: any;
}

// Generic asset type with required metadata structure
export interface AssetWithEvents {
  metadata: {
    id: string;
    events?: AssetEvent[];
    [key: string]: any;
  };
  file_path: string;
  [key: string]: any;
}

/**
 * Custom hook for managing asset events (event sourcing)
 * Provides event logging and retrieval for undo/redo functionality
 */
export const useAssetEvents = <T extends AssetWithEvents>(
  editedAssets: Accessor<Map<string, T>>,
  setEditedAssets: Setter<Map<string, T>>
) => {
  /**
   * Log an event for an asset
   * Updates local state and persists to backend
   */
  const logEvent = async (assetId: string, eventType: string, data?: any) => {
    const event: AssetEvent = {
      type: eventType,
      timestamp: Date.now(),
      data: data || {}
    };

    // Update local state
    setEditedAssets(prev => {
      const newMap = new Map(prev);
      const asset = newMap.get(assetId);
      if (asset) {
        if (!asset.metadata.events) {
          asset.metadata.events = [];
        }
        asset.metadata.events.push(event);
      }
      return newMap;
    });

    // Persist to backend
    try {
      const asset = editedAssets().get(assetId);
      if (asset) {
        await invoke("update_asset_metadata", {
          assetId,
          metadata: {
            ...asset.metadata,
            events: asset.metadata.events
          }
        });
      }
    } catch (err) {
      console.error("Failed to persist event:", err);
    }
  };

  /**
   * Get recent events for an asset
   * @param assetId - The asset ID
   * @param limit - Number of recent events to return (default: 5)
   * @returns Array of events in reverse chronological order
   */
  const getRecentEvents = (assetId: string, limit: number = 5): AssetEvent[] => {
    const asset = editedAssets().get(assetId);
    if (!asset?.metadata.events) return [];
    return asset.metadata.events.slice(-limit).reverse();
  };

  return {
    logEvent,
    getRecentEvents
  };
};
