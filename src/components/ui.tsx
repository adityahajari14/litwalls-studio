import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Shared UI primitives.
 *
 * Deliberately small — a handful of components covering what this app actually
 * uses, rather than a component library. The point is that a button looks the
 * same on every screen without each screen restating a dozen utility classes,
 * which is how the styling drifted in the first place.
 */

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ── Button ──────────────────────────────────────────────────────────── */

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45";

const BUTTON_VARIANTS = {
  primary: "bg-accent-600 text-white hover:bg-accent-700",
  secondary:
    "border border-paper-300 bg-white text-ink-700 hover:bg-paper-100 hover:border-paper-400",
  ghost: "text-ink-500 hover:bg-paper-100 hover:text-ink-700",
  danger:
    "border border-danger-500/30 bg-danger-50 text-danger-700 hover:bg-danger-500 hover:text-white hover:border-danger-500",
} as const;

const BUTTON_SIZES = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
  lg: "h-11 px-5 text-sm",
} as const;

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <button
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

export function ButtonLink({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <Link
      className={cx(
        BUTTON_BASE,
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

/* ── Surfaces ────────────────────────────────────────────────────────── */

export function Card({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        "rounded-[--radius-card] border border-paper-200 bg-white shadow-[--shadow-card]",
        className,
      )}
      {...props}
    />
  );
}

/** A labelled section. The label is the smallest thing on screen on purpose —
 *  it orients without competing with the content it introduces. */
export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/* ── Badge ───────────────────────────────────────────────────────────── */

const BADGE_TONES = {
  neutral: "border-paper-300 bg-paper-100 text-ink-500",
  ok: "border-ok-500/25 bg-ok-50 text-ok-700",
  warn: "border-warn-500/25 bg-warn-50 text-warn-700",
  danger: "border-danger-500/25 bg-danger-50 text-danger-700",
  accent: "border-accent-500/25 bg-accent-50 text-accent-700",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: keyof typeof BADGE_TONES }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-4",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ── Form fields ─────────────────────────────────────────────────────── */

const CONTROL =
  "w-full rounded-md border border-paper-300 bg-white px-2.5 py-1.5 text-sm text-ink-700 placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(CONTROL, "resize-y", className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-600">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

/* ── Segmented control ───────────────────────────────────────────────── */

/** Used for the size tabs and category picker: a small set of exclusive
 *  choices where seeing all the options at once matters more than saving
 *  space. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-md border border-paper-300 bg-paper-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cx(
            "rounded font-medium transition-colors",
            size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
            value === option.value
              ? "bg-white text-ink-900 shadow-[--shadow-card]"
              : "text-ink-500 hover:text-ink-700",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────── */

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[--radius-card] border border-dashed border-paper-300 bg-white/50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {children ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-ink-500">{children}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ── Page chrome ─────────────────────────────────────────────────────── */

export function PageHeader({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-paper-200 pb-5">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5">{eyebrow}</div> : null}
        <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-ink-900">
          {title}
        </h1>
        {meta ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-500">
            {meta}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm text-ink-500 transition-colors hover:text-ink-900"
    >
      <span aria-hidden>←</span>
      {children}
    </Link>
  );
}
