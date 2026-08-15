"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Persistent top navigation.
 *
 * Every screen previously had its own ad-hoc "← Dashboard" link and nothing
 * else, so Templates and Settings were only reachable from the home page. A
 * fixed bar means the three destinations are always one click away, and the
 * current one is always obvious.
 */
const LINKS = [
  { href: "/", label: "Batches" },
  { href: "/library", label: "Images" },
  { href: "/templates", label: "Mockups" },
  { href: "/settings", label: "Settings" },
];

export function AppNav() {
  const pathname = usePathname();

  const isCurrent = (href: string) =>
    href === "/"
      ? pathname === "/" || pathname.startsWith("/batches")
      : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-30 border-b border-paper-200 bg-paper-50/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-6">
        <Link href="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid size-6 place-items-center rounded bg-ink-900 text-[11px] font-bold text-paper-50"
          >
            L
          </span>
          <span className="text-sm font-semibold tracking-[-0.01em] text-ink-900">
            Litwalls Studio
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className={`rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ${
                isCurrent(link.href)
                  ? "bg-paper-200 text-ink-900"
                  : "text-ink-500 hover:bg-paper-100 hover:text-ink-700"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <span className="ml-auto text-xs text-ink-400">Local only</span>
      </div>
    </header>
  );
}
