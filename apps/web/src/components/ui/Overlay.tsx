import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "../../lib/format";
import { Button } from "./primitives";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useEscape(open, onClose);
  if (!open) return null;
  const width = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-2xl" : "max-w-lg";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={cx(
          "relative flex max-h-[92vh] w-full animate-pop-in flex-col rounded-t-2xl bg-paper shadow-2xl ring-1 ring-slate-200 sm:rounded-2xl dark:bg-slate-900 dark:ring-slate-800",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
          <div>
            <h2 className="display text-[26px] leading-tight text-slate-950 dark:text-white">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </div>
        {children && <div className="overflow-y-auto px-6 pb-5">{children}</div>}
        {footer && (
          <div className="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/60 px-6 py-4 sm:flex-row sm:justify-end dark:border-slate-800 dark:bg-slate-900/60">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirmer",
  danger,
  loading,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  width = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={cx("absolute inset-y-0 right-0 flex w-full animate-slide-in-right flex-col bg-paper shadow-2xl dark:bg-slate-900", width)}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0 display text-[26px] leading-tight text-slate-950 dark:text-white">{title}</div>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
