import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Shared UI primitives.
 *
 * Deliberately small — what this app actually uses, not a component library.
 * The point is that a button looks the same everywhere without each screen
 * restating a dozen utility classes, which is how the styling drifted before.
 */

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/* ── Button ──────────────────────────────────────────────────────────── */

// A one-pixel rise on hover and a one-pixel press on click — the whole
// tactile read comes from two transform states, not from a shadow or a glow.
const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 hover:-translate-y-px active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0";

const BUTTON_VARIANTS = {
  /* A flat indigo fill with a lit top edge. No glow — depth comes from the
     inset highlight and the surface beneath, which is how a real control
     reads. White text clears contrast comfortably on this fill. */
  primary:
    "bg-accent-500 text-white shadow-[inset_0_1px_0_0_rgb(255_255_255_/_0.18)] hover:bg-accent-600",
  secondary:
    "border border-paper-400/70 bg-paper-200 text-ink-700 hover:border-paper-500 hover:bg-paper-300 hover:text-ink-900",
  ghost: "text-ink-500 hover:bg-paper-200 hover:text-ink-900",
  danger:
    "border border-danger-500/30 bg-danger-50 text-danger-700 hover:border-danger-500/60 hover:bg-danger-500/15",
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

/**
 * A button-shaped plain anchor, for hrefs the router must not try to own.
 *
 * `next/link` fetches an RSC payload before navigating. Point it at a Route
 * Handler that 302s to Google and that fetch fails, logging an error before
 * falling back to a real navigation. It works, but noisily and a round trip
 * late — so anything leaving the app entirely uses this instead.
 */
export function ButtonAnchor({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"a"> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <a
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

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx(
        // transition-colors as a default, not per call site: a Card that adds
        // a hover: border or background further down the tree gets a smooth
        // change for free instead of every caller having to remember to add it.
        "rounded-[--radius-card] border border-paper-300/80 bg-gradient-to-b from-paper-200/80 to-paper-100 shadow-[--shadow-card] transition-colors duration-200",
        className,
      )}
      {...props}
    />
  );
}

/** A labelled section. The label is the smallest thing on screen on purpose —
 *  it orients without competing with what it introduces. */
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
        <h2 className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-ink-400">
          {/* A short tick before the label — an anchor for the eye when
              scanning a long page for a particular section. */}
          <span aria-hidden className="h-3 w-px bg-paper-500" />
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/* ── Badge ───────────────────────────────────────────────────────────── */

const BADGE_TONES = {
  neutral: "border-paper-400/50 bg-paper-200 text-ink-500",
  ok: "border-ok-500/30 bg-ok-500/10 text-ok-700",
  warn: "border-warn-500/30 bg-warn-500/10 text-warn-700",
  danger: "border-danger-500/30 bg-danger-500/10 text-danger-700",
  accent: "border-accent-500/35 bg-accent-500/10 text-accent-700",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: keyof typeof BADGE_TONES }) {
  return (
    <span
      className={cx(
        // Fades in on mount unconditionally — cheap because it is just a CSS
        // animation on a leaf node, and it is what turns "a badge for a new
        // warning appeared" from a silent layout shift into something the eye
        // actually catches.
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4 animate-fade-rise",
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/* ── Form fields ─────────────────────────────────────────────────────── */

const CONTROL =
  "w-full rounded-lg border border-paper-300 bg-paper-200 px-2.5 py-1.5 text-sm text-ink-900 placeholder:text-ink-400 transition-colors focus:border-accent-500 focus:outline-none focus:ring-1 focus:ring-accent-500/60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(CONTROL, "resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(CONTROL, className)} {...props} />;
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
      <span className="mb-1.5 block text-xs font-medium text-ink-600">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-xs text-ink-400">{hint}</span>
      ) : null}
    </label>
  );
}

/** File input — the native control is stubbornly light without this. */
export function FileInput({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      type="file"
      className={cx(
        "block w-full text-xs text-ink-500",
        "file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-paper-300 file:bg-paper-200 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-ink-700 hover:file:border-paper-400 hover:file:text-ink-900",
        className,
      )}
      {...props}
    />
  );
}

/* ── Segmented control ───────────────────────────────────────────────── */

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
    <div className="inline-flex rounded-lg border border-paper-300 bg-paper-100 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cx(
            "rounded-md font-medium transition-all",
            size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
            value === option.value
              ? "bg-paper-300 text-ink-900"
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
    <div className="rounded-[--radius-card] border border-dashed border-paper-300 bg-paper-100/40 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {children ? (
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-500">{children}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
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
    <header className="pb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <div className="mb-2.5">{eyebrow}</div> : null}
          <h1 className="truncate bg-gradient-to-b from-ink-900 to-ink-600 bg-clip-text text-[1.65rem] font-semibold leading-tight tracking-[-0.025em] text-transparent">
            {title}
          </h1>
          {meta ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-500">
              {meta}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      <hr className="rule-fade mt-5" />
    </header>
  );
}

export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.1em] text-ink-400 transition-colors hover:text-accent-700"
    >
      <span aria-hidden>←</span>
      {children}
    </Link>
  );
}
