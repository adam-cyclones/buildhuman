import { emit, listen } from "@tauri-apps/api/event";
import { delay, saveSnapshot, writeSnapshotStatus } from "./utils";

export const SNAPSHOT_DELAY_MS = 10000;
export const SNAPSHOT_READY_TIMEOUT_MS = 15000;

export const waitForMeshReady = async (
  getMeshReady: () => boolean,
  timeoutMs: number
) => {
  const start = Date.now();
  while (!getMeshReady() && Date.now() - start < timeoutMs) {
    await delay(200);
  }
};

export const captureAndEmitSnapshot = async (
  source: "auto" | "request",
  getMeshReady: () => boolean,
  getCanvas: () => HTMLCanvasElement | undefined,
  getRenderer: () => THREE.WebGLRenderer | undefined,
  getScene: () => THREE.Scene | undefined,
  getCamera: () => THREE.Camera | undefined
) => {
  try {
    await writeSnapshotStatus(`capture start source=${source} meshReady=${getMeshReady()}`);
    await waitForMeshReady(getMeshReady, SNAPSHOT_READY_TIMEOUT_MS);

    const canvas = getCanvas();
    if (!canvas) {
      console.warn("Snapshot requested before canvas is ready.");
      await emit("snapshot-done", "");
      return;
    }

    const filePath = await saveSnapshot(canvas, getRenderer(), getScene(), getCamera());
    if (filePath) {
      await emit("snapshot-done", { path: filePath, source });
      await writeSnapshotStatus(`capture done source=${source} path=${filePath}`);
    } else {
      await emit("snapshot-done", "");
      await writeSnapshotStatus(`capture done source=${source} path=empty`);
    }
  } catch (error) {
    console.error("Snapshot capture failed:", error);
    await emit("snapshot-done", "");
    await writeSnapshotStatus(`capture failed source=${source}`);
  }
};

export const setupSnapshotAutomation = async (
  getMeshReady: () => boolean,
  getCanvas: () => HTMLCanvasElement | undefined,
  getRenderer: () => THREE.WebGLRenderer | undefined,
  getScene: () => THREE.Scene | undefined,
  getCamera: () => THREE.Camera | undefined,
  onCleanup: (cleanup: () => void) => void
) => {
  if (!import.meta.env.DEV) {
    return;
  }

  await writeSnapshotStatus(`automation initialized dev=${import.meta.env.DEV}`);

  const timeoutId = window.setTimeout(() => {
    void captureAndEmitSnapshot("auto", getMeshReady, getCanvas, getRenderer, getScene, getCamera);
  }, SNAPSHOT_DELAY_MS);

  const listener = await listen("request-snapshot", async () => {
    await delay(SNAPSHOT_DELAY_MS);
    await captureAndEmitSnapshot("request", getMeshReady, getCanvas, getRenderer, getScene, getCamera);
  });

  onCleanup(() => {
    clearTimeout(timeoutId);
    listener();
  });
};
