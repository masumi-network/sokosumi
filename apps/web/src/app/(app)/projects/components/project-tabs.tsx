"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface ProjectTab {
  /** Stable key, also the value reported by `aria-controls`-free tab markup. */
  id: string;
  href: string;
  label: string;
  /**
   * Match this path and nothing below it.
   *
   * The overview tab needs it: its href is `/projects/:id`, which is a prefix
   * of every other tab *and* of `/projects/:id/edit`, so a prefix match lit
   * Overview up on pages that are not it.
   */
  exact?: boolean;
}

/**
 * Which tab a path is in.
 *
 * Longest match wins, so `/projects/:id/studio` does not resolve to the
 * overview tab whose href is a prefix of every other one. Anything below a
 * tab's route — a future `/studio/settings`, say — still highlights its tab.
 * A route that belongs to no tab, such as `/projects/:id/edit`, highlights
 * nothing, which is why the overview tab is matched exactly.
 */
export function activeProjectTabId(
  pathname: string,
  tabs: readonly ProjectTab[],
): string | null {
  let best: ProjectTab | null = null;
  for (const tab of tabs) {
    const matches = tab.exact
      ? pathname === tab.href
      : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    if (!matches) continue;
    if (!best || tab.href.length > best.href.length) best = tab;
  }
  return best?.id ?? null;
}

/**
 * The project's subpages, as one segmented control.
 *
 * Real links, not a client-side tab widget: each subpage is its own route that
 * renders on the server, so a tab is bookmarkable, opens in a new tab with a
 * middle click, and prefetches. `role="tablist"` is deliberately *not* used —
 * these are navigations, and announcing them as tabs would promise the
 * arrow-key model that a link list does not have.
 */
export function ProjectTabs({
  ariaLabel,
  tabs,
}: {
  ariaLabel: string;
  tabs: readonly ProjectTab[];
}) {
  const pathname = usePathname();
  const activeId = activeProjectTabId(pathname, tabs);

  return (
    // The wrapper scrolls, not the pill strip: on a narrow phone five tabs are
    // wider than the screen, and a clipped strip would hide the last one.
    <nav
      aria-label={ariaLabel}
      className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden"
    >
      <div className="bg-card-background flex w-fit items-center gap-1 rounded-lg p-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                "focus-visible:ring-ring-halo outline-none focus-visible:ring-[3px]",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              href={tab.href}
              key={tab.id}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
