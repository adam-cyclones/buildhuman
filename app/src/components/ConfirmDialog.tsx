import { createSignal, Show, onMount, onCleanup } from "solid-js";
import Icon from "./Icon";
import "./ConfirmDialog.css";

export type ConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
};

const ConfirmDialog = (props: ConfirmDialogProps) => {
  let dialogRef: HTMLDialogElement | undefined;

  onMount(() => {
    if (props.isOpen && dialogRef) {
      dialogRef.showModal();
    }
  });

  // Handle ESC key and backdrop click
  const handleCancel = (e: Event) => {
    e.preventDefault();
    props.onCancel();
  };

  const handleConfirm = () => {
    props.onConfirm();
    if (dialogRef) {
      dialogRef.close();
    }
  };

  const handleCancelClick = () => {
    props.onCancel();
    if (dialogRef) {
      dialogRef.close();
    }
  };

  // Watch for isOpen changes
  const handleOpen = () => {
    if (props.isOpen && dialogRef && !dialogRef.open) {
      dialogRef.showModal();
    } else if (!props.isOpen && dialogRef?.open) {
      dialogRef.close();
    }
  };

  // Re-run when isOpen changes
  onMount(() => {
    const interval = setInterval(handleOpen, 100);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <Show when={props.isOpen}>
      <dialog
        ref={dialogRef}
        class={`confirm-dialog ${props.variant || "default"}`}
        onCancel={handleCancel}
      >
        <div class="dialog-content">
          <div class="dialog-header">
            <h2 class="dialog-title">{props.title}</h2>
            <button
              class="dialog-close"
              onClick={handleCancelClick}
              type="button"
              aria-label="Close dialog"
            >
              <Icon name="close" size={20} />
            </button>
          </div>

          <div class="dialog-body">
            <p class="dialog-message">{props.message}</p>
          </div>

          <div class="dialog-footer">
            <button
              class="dialog-btn cancel-btn"
              onClick={handleCancelClick}
              type="button"
            >
              {props.cancelText || "Cancel"}
            </button>
            <button
              class={`dialog-btn confirm-btn ${props.variant || "default"}`}
              onClick={handleConfirm}
              type="button"
              autofocus
            >
              {props.confirmText || "Confirm"}
            </button>
          </div>
        </div>
      </dialog>
    </Show>
  );
};

export default ConfirmDialog;
