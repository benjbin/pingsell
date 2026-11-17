import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { ChevronLeft, ChevronRight, Loader2, type LucideIcon } from "lucide-react";
import { cx } from "../../lib/format";
import type { Tone } from "../../lib/constants";

// --- Button ---------------------------------------------------------------

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-slate-900 text-white hover:bg-brand-500 focus-visible:outline-brand-500 dark:bg-white dark:text-slate-900 dark:hover:bg-brand-500 dark:hover:text-white",
  accent: "bg-brand-500 text-white shadow-lg shadow-brand-500/25 hover:bg-brand-600 focus-visible:outline-brand-500",
  secondary:
    "bg-white text-slate-900 ring-1 ring-inset ring-slate-900/15 hover:ring-slate-900/40 dark:bg-white/5 dark:text-slate-100 dark:ring-white/15 dark:hover:ring-white/40",
  outline:
    "bg-transparent text-brand-600 ring-1 ring-inset ring-brand-200 hover:bg-brand-50 dark:text-brand-400 dark:ring-brand-800 dark:hover:bg-brand-900/40",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-xs gap-1.5",
  md: "h-10 px-5 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: LucideIcon;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon: Icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-display font-semibold whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
});

// --- Card -----------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "rounded-[20px] border border-slate-900/10 bg-white dark:border-white/10 dark:bg-slate-900",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-wrap items-center justify-between gap-3 border-b border-slate-900/10 px-6 py-5 dark:border-white/10", className)}>
      <div className="min-w-0">
        <h3 className="font-display text-[15px] font-bold tracking-tight text-slate-900 uppercase dark:text-white">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// --- Badge ----------------------------------------------------------------

const tones: Record<Tone, string> = {
  brand: "bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-900/40 dark:text-brand-300 dark:ring-brand-400/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-400/20",
  amber: "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-400/20",
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-400/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/15 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/15 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-400/20",
};

export function Badge({ tone = "slate", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      #{tag}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 rounded hover:text-brand-900 dark:hover:text-white" aria-label={`Retirer ${tag}`}>
          ×
        </button>
      )}
    </span>
  );
}

// --- Form controls --------------------------------------------------------

const controlBase =
  "block rounded-xl border-0 bg-white px-3.5 text-sm text-slate-900 ring-1 ring-inset ring-slate-900/15 placeholder:text-slate-400 " +
  "focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 " +
  "dark:bg-slate-950 dark:text-slate-100 dark:ring-white/15 dark:placeholder:text-slate-500 dark:disabled:bg-slate-900";

/** Default width/height unless the caller sets its own (avoids conflicting utilities). */
function sizing(className: string | undefined, height: string | null): string {
  const tokens = (className ?? "").split(/\s+/);
  const hasWidth = tokens.some((t) => /^(w-|min-w-|max-w-)/.test(t) && !t.startsWith("max-w-"));
  const hasHeight = tokens.some((t) => /^h-/.test(t));
  return cx(!hasWidth && "w-full", height && !hasHeight && height);
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(controlBase, sizing(className, "h-10"), className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(controlBase, sizing(className, null), "py-2.5", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(controlBase, sizing(className, "h-10"), "pr-8", className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

// --- Feedback -------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-slate-200/70 dark:bg-slate-800", className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-brand-500", className)} />;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
        <Icon className="size-6" />
      </div>
      <h3 className="font-display text-[15px] font-bold tracking-tight text-slate-900 uppercase dark:text-white">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center dark:border-red-900/50 dark:bg-red-950/30">
      <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

// --- Layout helpers -------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back}
        <h1 className="display text-[34px] leading-[0.95] text-slate-900 sm:text-[44px] dark:text-white">
          {title}
          <span className="text-brand-500">.</span>
        </h1>
        {description && <p className="mt-3 max-w-2xl text-[15px] text-slate-600 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <div className="rounded-[20px] bg-slate-100 p-6 dark:bg-white/[0.05]">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {Icon && (
          <span className="flex size-9 items-center justify-center rounded-full text-slate-900 ring-1 ring-slate-900/15 dark:text-white dark:ring-white/15">
            <Icon className="size-4" strokeWidth={1.5} />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-4 font-display text-[40px] leading-none font-extrabold tracking-[-0.03em] text-slate-900 tabular-nums dark:text-white">{value}</p>
      )}
      {hint && !loading && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onChange,
}: {
  page: number;
  limit: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm dark:border-slate-800">
      <p className="text-slate-500 dark:text-slate-400">
        <span className="font-medium text-slate-700 tabular-nums dark:text-slate-200">
          {from}–{to}
        </span>{" "}
        sur <span className="font-medium text-slate-700 tabular-nums dark:text-slate-200">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Page précédente" />
        <span className="px-2 text-slate-500 tabular-nums dark:text-slate-400">
          {page} / {pages}
        </span>
        <Button variant="secondary" size="sm" icon={ChevronRight} disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Page suivante" />
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode; icon?: LucideIcon }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx("inline-flex rounded-full bg-slate-100 p-1 dark:bg-white/5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-xs font-semibold whitespace-nowrap transition",
            value === o.value
              ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
              : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
          )}
        >
          {o.icon && <o.icon className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white",
        className,
      )}
    >
      {text}
    </span>
  );
}

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-5 py-4">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={cx("h-4", c === 0 ? "w-1/3" : "w-1/6")} />
          ))}
        </div>
      ))}
    </div>
  );
}
