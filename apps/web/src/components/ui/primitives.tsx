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
  primary:
    "bg-slate-950 text-paper hover:bg-brand-500 hover:text-white dark:bg-paper dark:text-slate-950 dark:hover:bg-brand-500 dark:hover:text-white",
  accent: "bg-brand-500 text-white hover:bg-slate-950 dark:hover:bg-paper dark:hover:text-slate-950",
  secondary:
    "bg-transparent text-slate-900 ring-1 ring-inset ring-slate-300 hover:ring-slate-950 hover:bg-white/60 dark:text-slate-100 dark:ring-slate-700 dark:hover:ring-slate-300 dark:hover:bg-white/5",
  outline:
    "bg-transparent text-brand-600 ring-1 ring-inset ring-brand-300 hover:bg-brand-500 hover:text-white hover:ring-brand-500 dark:text-brand-400 dark:ring-brand-800",
  ghost: "text-slate-600 hover:bg-slate-950/5 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-xs gap-1.5",
  md: "h-10 px-5 text-[13px] gap-2",
  lg: "h-12 px-6 text-sm gap-2",
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
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium tracking-[-0.01em] whitespace-nowrap transition-all duration-200 active:scale-[0.97]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
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
        "rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60",
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
    <div className={cx("flex flex-wrap items-end justify-between gap-3 border-b border-slate-200/80 px-6 pt-5 pb-4 dark:border-slate-800", className)}>
      <div className="min-w-0">
        <h3 className="display text-[22px] leading-tight text-slate-950 dark:text-white">{title}</h3>
        {description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// --- Badge ----------------------------------------------------------------

const tones: Record<Tone, string> = {
  brand: "text-brand-600 ring-brand-500/40 dark:text-brand-400 dark:ring-brand-400/40",
  green: "text-emerald-700 ring-emerald-700/30 dark:text-emerald-400 dark:ring-emerald-400/30",
  amber: "text-amber-700 ring-amber-600/40 dark:text-amber-400 dark:ring-amber-400/30",
  red: "text-red-700 ring-red-600/30 dark:text-red-400 dark:ring-red-400/30",
  slate: "text-slate-600 ring-slate-400/50 dark:text-slate-300 dark:ring-slate-600",
  blue: "text-sky-700 ring-sky-600/30 dark:text-sky-400 dark:ring-sky-400/30",
};

export function Badge({ tone = "slate", children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10.5px] font-medium tracking-wider whitespace-nowrap uppercase ring-1 ring-inset",
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
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-950/[0.06] px-2 py-0.5 font-mono text-[10.5px] text-slate-700 dark:bg-white/10 dark:text-slate-300">
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
  "block rounded-xl border-0 bg-white/80 px-3.5 text-sm text-slate-950 ring-1 ring-inset ring-slate-300/80 placeholder:text-slate-400 transition " +
  "hover:ring-slate-400 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-slate-950 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 " +
  "dark:bg-white/[0.03] dark:text-slate-100 dark:ring-slate-700 dark:placeholder:text-slate-500 dark:hover:ring-slate-500 dark:focus:bg-white/[0.05] dark:focus:ring-slate-200 dark:disabled:bg-slate-900";

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
      <label htmlFor={htmlFor} className="eyebrow mb-2 block">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

// --- Feedback -------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-slate-950/[0.06] dark:bg-white/[0.06]", className)} />;
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
      <div className="mb-5 flex size-14 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-400 dark:border-slate-700 dark:text-slate-500">
        <Icon className="size-5" strokeWidth={1.5} />
      </div>
      <h3 className="display text-2xl text-slate-950 dark:text-white">{title}</h3>
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
    <div className="mb-8 flex animate-rise flex-col gap-5 border-b border-slate-950/10 pb-7 sm:mb-10 sm:flex-row sm:items-end sm:justify-between dark:border-white/10">
      <div className="min-w-0">
        {back}
        <h1 className="display text-[44px] leading-[0.95] text-slate-950 sm:text-[56px] dark:text-white">{title}</h1>
        {description && <p className="mt-3 max-w-xl text-sm text-slate-500 dark:text-slate-400">{description}</p>}
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
    <Card className="group relative overflow-hidden p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {Icon && <Icon className="size-4 text-slate-400 transition-colors group-hover:text-brand-500" strokeWidth={1.5} />}
      </div>
      {loading ? (
        <Skeleton className="mt-5 h-12 w-28" />
      ) : (
        <p className="display mt-4 text-[56px] leading-none text-slate-950 tabular-nums dark:text-white">{value}</p>
      )}
      {hint && !loading && <p className="mt-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
      <span className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-brand-500 transition-transform duration-500 group-hover:scale-x-100" />
    </Card>
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
    <div className="flex items-center justify-between gap-3 border-t border-slate-200/80 px-6 py-3 font-mono text-xs dark:border-slate-800">
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
    <div className={cx("inline-flex rounded-full p-1 ring-1 ring-inset ring-slate-300/80 dark:ring-slate-700", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] font-medium whitespace-nowrap transition",
            value === o.value
              ? "bg-slate-950 text-paper dark:bg-paper dark:text-slate-950"
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
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-500 font-display text-base text-slate-950 italic",
        className,
      )}
    >
      {text}
    </span>
  );
}

export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-slate-200/70 dark:divide-slate-800">
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
