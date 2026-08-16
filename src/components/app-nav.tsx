"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Search } from "@/components/search";

/** Matches the nav links' own `px-3` — the indicator tracks the label's
 *  width, not the wider clickable padding box around it. */
const LINK_INSET_PX = 12;

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
  const navRef = useRef<HTMLElement>(null);
  const linkRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(
    null,
  );

  const isCurrent = (href: string) =>
    href === "/"
      ? pathname === "/" || pathname.startsWith("/batches")
      : pathname.startsWith(href);

  /**
   * One indicator element, slid and resized to whichever link is current,
   * rather than a separate underline per link. Two underlines popping in and
   * out at different positions reads as two unrelated events; one element
   * moving between them reads as a single, continuous "you are here".
   *
   * Measured in a layout effect off the actual DOM boxes rather than derived
   * from index * some-fixed-width, because the five labels are not the same
   * width and never will be.
   */
  useEffect(() => {
    const active = LINKS.find((link) => isCurrent(link.href));
    const el = active ? linkRefs.current.get(active.href) : undefined;
    const nav = navRef.current;
    if (!el || !nav) {
      setIndicator(null);
      return;
    }

    const measure = () => {
      const navBox = nav.getBoundingClientRect();
      const linkBox = el.getBoundingClientRect();
      setIndicator({
        left: linkBox.left - navBox.left + LINK_INSET_PX,
        width: linkBox.width - LINK_INSET_PX * 2,
      });
    };

    measure();
    // The bar's own layout can shift (window resize, a font finishing load)
    // without the route changing, and a stale indicator position left
    // sitting under the wrong label reads as a bug, not a style choice.
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

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

        <nav ref={navRef} className="relative flex items-center gap-0.5">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              ref={(el) => {
                if (el) linkRefs.current.set(link.href, el);
                else linkRefs.current.delete(link.href);
              }}
              href={link.href}
              aria-current={isCurrent(link.href) ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isCurrent(link.href)
                  ? "text-ink-900"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              {link.label}
            </Link>
          ))}
          {/* An underline rather than a filled pill — it marks the section
              without adding another box to an already dense bar. One element
              that slides between labels, not a fresh one popping up under
              each — see the measuring effect above. */}
          {indicator ? (
            <span
              aria-hidden
              className="absolute -bottom-[13px] h-px bg-accent-500 transition-[left,width] duration-300 ease-out"
              style={{ left: indicator.left, width: indicator.width }}
            />
          ) : null}
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
