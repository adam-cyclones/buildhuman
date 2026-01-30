import { invoke } from "@tauri-apps/api/core";
import type { Skeleton } from "../../../morphing/skeleton";
import type { MouldManager } from "../../../morphing/mould-manager";

export const syncToRustBackend = async (
  skeleton: Skeleton,
  mouldManager: MouldManager
): Promise<void> => {
  try {
    // Convert skeleton to serializable format
    const joints = skeleton.getJoints().map((j) => ({
      id: j.id,
      local_offset: {
        x: j.localOffset[0],
        y: j.localOffset[1],
        z: j.localOffset[2],
      },
      local_rotation: {
        x: j.localRotation[0],
        y: j.localRotation[1],
        z: j.localRotation[2],
        w: j.localRotation[3],
      },
      parent_id: j.parentId,
      children: j.children,
    }));

    // Convert moulds to serializable format
    const moulds = mouldManager.getMoulds().map((m) => {
      // Convert kebab-case to PascalCase for Rust enum (e.g., "profiled-capsule" -> "ProfiledCapsule")
      const shapePascalCase = m.shape
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');

      return {
        id: m.id,
        shape: shapePascalCase,
        center: {
          x: m.center[0],
          y: m.center[1],
          z: m.center[2],
        },
        radius: m.radius,
        blend_radius: m.blendRadius,
        parent_joint_id: m.parentJointId,
        end_point: m.endPoint
          ? {
              x: m.endPoint[0],
              y: m.endPoint[1],
              z: m.endPoint[2],
            }
          : null,
        radial_profiles: m.radialProfiles || null,
        use_splines: m.useSplines !== undefined ? m.useSplines : null,
      };
    });

    // Send to Rust backend
    await invoke("update_skeleton", { joints });
    await invoke("update_moulds", { moulds });
  } catch (e) {
    console.error("Error syncing to Rust backend:", e);
  }
};

export const createRustSyncScheduler = (
  getSkeleton: () => Skeleton | undefined,
  getMouldManager: () => MouldManager | undefined
) => {
  let syncDebounceTimer: number | undefined;
  let syncInFlight = false;
  let syncQueued = false;

  const runSync = async () => {
    const skeleton = getSkeleton();
    const mouldManager = getMouldManager();

    if (!skeleton || !mouldManager) {
      console.warn(
        "Cannot sync to Rust: skeleton or mould manager not initialized"
      );
      return;
    }

    if (syncInFlight) {
      syncQueued = true;
      return;
    }
    syncInFlight = true;
    try {
      await syncToRustBackend(skeleton, mouldManager);
    } finally {
      syncInFlight = false;
      if (syncQueued) {
        syncQueued = false;
        void runSync();
      }
    }
  };

  const scheduleSync = (immediate: boolean = false): Promise<void> | void => {
    if (immediate) {
      if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer);
        syncDebounceTimer = undefined;
      }
      return runSync(); // Return promise for immediate syncs
    }

    if (syncDebounceTimer) return;
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = undefined;
      void runSync();
    }, 80) as unknown as number;
  };

  return { scheduleSync };
};
