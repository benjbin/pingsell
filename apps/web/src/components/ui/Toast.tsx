import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { errorMessage } from "../../lib/api";
import { cx } from "../../lib/format";
import { t } from "../../lib/i18n";

type Kind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: Kind;
  title: string;
  description?: string;
}

interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (titleOrError: unknown, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (kind: Kind, title: string, description?: string) => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-3), { id, kind, title, description }]);
      setTimeout(() => dismiss(id), kind === "error" ? 6000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push("success", title, description),
      info: (title, description) => push("info", title, description),
      error: (titleOrError, description) =>
        typeof titleOrError === "string"
          ? push("error", titleOrError, description)
          : push("error", t("Une erreur est survenue", "Something went wrong"), errorMessage(titleOrError)),
    }),
    [push],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
          {toasts.map((toast) => {
            const Icon = toast.kind === "success" ? CheckCircle2 : toast.kind === "error" ? XCircle : Info;
            return (
              <div
                key={toast.id}
                className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
              >
                <Icon
                  className={cx(
                    "mt-0.5 size-5 shrink-0",
                    toast.kind === "success" && "text-emerald-500",
                    toast.kind === "error" && "text-red-500",
                    toast.kind === "info" && "text-brand-500",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{toast.title}</p>
                  {toast.description && <p className="mt-0.5 text-sm break-words text-slate-500 dark:text-slate-400">{toast.description}</p>}
                </div>
                <button onClick={() => dismiss(toast.id)} className="text-slate-400 hover:text-slate-600" aria-label={t("Fermer", "Close")}>
                  <X className="size-4" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
