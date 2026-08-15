"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Search } from "@/components/search";

/**
 * Persistent top navigation.
 *
 * Every screen previously carried its own ad-hoc "← Dashboard" link and
 * nothing else, so Templates and Settings were reachable only from the home
 * page. A fixed bar keeps every destination one click away and always shows
 * where you are.
 */
const LINKS = [
  { href: "/", label: "Batches" },
  { href: "/published", label: "Published" },
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
    <header className="sticky top-0 z-30 border-b border-paper-300/60 bg-paper-50/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-7 px-6">
        <Link href="/" className="group flex items-center gap-2.5">
          {/* The real wordmark. The source ships on a white plate, so it is
              keyed to transparency at build-prep time — see the note in the
              README; dropping it in raw puts a white box in the dark nav. */}
          <Image
            src="/brand/logo.png"
            alt="Litwalls"
            width={155}
            height={54}
            priority
            className="h-7 w-auto opacity-95 transition-opacity duration-200 group-hover:opacity-100"
          />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-ink-400 sm:inline">
            Studio
          </span>
        </Link>

        <nav className="flex items-center gap-0.5">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isCurrent(link.href)
                  ? "text-ink-900"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              {link.label}
              {/* An underline rather than a filled pill — it marks the section
                  without adding another box to an already dense bar. */}
              {isCurrent(link.href) ? (
                <span
                  aria-hidden
                  className="absolute inset-x-3 -bottom-[13px] h-px bg-accent-500"
                />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Search />
          <span className="hidden items-center gap-2 rounded-full border border-paper-300/70 bg-paper-100/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-400 lg:flex">
            <span aria-hidden className="breathe size-1.5 rounded-full bg-ok-500" />
            Local
          </span>
        </div>
      </div>
    </header>
  );
}
