import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import Icon from "./Icon";
import type { Release, Asset } from "../views/AssetLibrary/types";
import "./ReleaseAnnouncementModal.css";

export type ReleaseAnnouncementModalProps = {
  isOpen: boolean;
  release: Release | null;
  assets: Asset[];
  onClose: () => void;
  onDownloadAsset: (assetId: string, assetName: string) => void;
  downloadingAssetId: string | null;
  convertToAssetPath: (url: string, cacheBust: boolean) => string;
};

const ReleaseAnnouncementModal = (props: ReleaseAnnouncementModalProps) => {
  let dialogRef: HTMLDialogElement | undefined;

  const handleCancel = (e: Event) => {
    e.preventDefault();
    props.onClose();
  };

  const handleClose = () => {
    if (dialogRef) {
      dialogRef.close();
    }
    props.onClose();
  };

  // Dialog management
  onMount(() => {
    if (props.isOpen && dialogRef && !dialogRef.open) {
      dialogRef.showModal();
    }
  });

  // Watch for isOpen changes
  const handleOpen = () => {
    if (props.isOpen && dialogRef && !dialogRef.open) {
      dialogRef.showModal();
    } else if (!props.isOpen && dialogRef?.open) {
      dialogRef.close();
    }
  };

  onMount(() => {
    const interval = setInterval(handleOpen, 100);
    onCleanup(() => clearInterval(interval));
  });

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <Show when={props.isOpen && props.release}>
      <dialog ref={dialogRef} class="release-announcement-modal" onCancel={handleCancel}>
        <div class="announcement-modal-content">
          <div class="announcement-modal-header">
            <div class="header-icon">
              <Icon name="rocket" size={32} />
            </div>
            <div class="header-text">
              <h2>{props.release!.name}</h2>
              <div class="release-version-date">
                <span class="version-badge">v{props.release!.version}</span>
                <span class="release-date">{formatDate(props.release!.published_at || props.release!.created_at)}</span>
              </div>
            </div>
            <button class="close-btn" onClick={handleClose} type="button" aria-label="Close">
              <Icon name="close" size={24} />
            </button>
          </div>

          <div class="announcement-modal-body">
            <Show when={props.release!.description}>
              <div class="release-description">
                <p>{props.release!.description}</p>
              </div>
            </Show>

            <div class="assets-section">
              <h3>What's New ({props.assets.length} assets)</h3>
              <div class="assets-grid">
                <For each={props.assets}>
                  {(asset) => (
                    <div class="release-asset-card">
                      <div class="asset-thumbnail">
                        <Show
                          when={asset.thumbnail_url}
                          fallback={
                            <div class="placeholder-icon">
                              <Icon name="image" size={48} />
                            </div>
                          }
                        >
                          <img
                            src={props.convertToAssetPath(asset.thumbnail_url!, false)}
                            alt={asset.name}
                            class="thumbnail-image"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        </Show>
                      </div>

                      <div class="asset-details">
                        <div class="asset-name">{asset.name}</div>
                        <div class="asset-meta">
                          <span>{asset.type}</span>
                          <span>•</span>
                          <span>{asset.category}</span>
                        </div>
                        <Show when={asset.description}>
                          <div class="asset-description">{asset.description}</div>
                        </Show>
                      </div>

                      <div class="asset-actions">
                        <button
                          class="download-btn"
                          onClick={() => props.onDownloadAsset(asset.id, asset.name)}
                          disabled={props.downloadingAssetId === asset.id}
                          title="Download asset"
                        >
                          <Show
                            when={props.downloadingAssetId === asset.id}
                            fallback={
                              <>
                                <Icon name="download" size={16} />
                                Download
                              </>
                            }
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2.5"
                              stroke-linecap="round"
                              class="spinner"
                            >
                              <path
                                d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"
                                opacity="0.4"
                              />
                              <path d="M12 2v4" opacity="1" />
                            </svg>
                            Downloading...
                          </Show>
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>

          <div class="announcement-modal-footer">
            <button class="btn btn-primary" onClick={handleClose} type="button">
              Got it!
            </button>
          </div>
        </div>
      </dialog>
    </Show>
  );
};

export default ReleaseAnnouncementModal;
