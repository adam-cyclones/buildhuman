import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { mkdir, readDir, remove, writeFile } from "@tauri-apps/plugin-fs";
import type * as THREE from "three";

export const SNAPSHOT_DIR_NAME = "debug-snapshots";

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const writeSnapshotStatus = async (message: string) => {
  try {
    const snapshotDir = await ensureSnapshotDir();
    const statusPath = await join(snapshotDir, "snapshot-status.txt");
    const payload = `${new Date().toISOString()} ${message}\n`;
    const bytes = new TextEncoder().encode(payload);
    await writeFile(statusPath, bytes);
  } catch (error) {
    console.warn("Failed to write snapshot status:", error);
  }
};

export const ensureSnapshotDir = async () => {
  const appDataPath = await invoke<string>("get_app_data_path");
  const snapshotDir = await join(appDataPath, SNAPSHOT_DIR_NAME);
  await mkdir(snapshotDir, { recursive: true });
  return snapshotDir;
};

export const clearOldSnapshots = async (snapshotDir: string, keepPath?: string) => {
  try {
    const entries = await readDir(snapshotDir);
    for (const entry of entries) {
      if (entry.path && entry.name?.endsWith(".png") && entry.path !== keepPath) {
        await remove(entry.path, { recursive: true });
      }
    }
  } catch (error) {
    console.warn("Failed to clear old snapshots:", error);
  }
};

export const saveSnapshot = async (
  canvas: HTMLCanvasElement,
  renderer?: THREE.WebGLRenderer,
  scene?: THREE.Scene,
  camera?: THREE.Camera
): Promise<string | null> => {
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }

  // Wait for a couple of frames to ensure the WebGL backbuffer is populated.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((result) => resolve(result), "image/png")
  );
  if (!blob) {
    console.warn("Failed to capture canvas snapshot.");
    return null;
  }

  const snapshotDir = await ensureSnapshotDir();
  await clearOldSnapshots(snapshotDir);

  const filename = `snapshot-${Date.now()}.png`;
  const filePath = await join(snapshotDir, filename);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await writeFile(filePath, bytes);
  await clearOldSnapshots(snapshotDir, filePath);
  return filePath;
};
