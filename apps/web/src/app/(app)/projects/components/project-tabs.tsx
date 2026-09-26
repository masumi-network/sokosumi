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
 * The project's subpages, as one underlined row anchored to a full-bleed rule.
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
    // The rule runs the full width of the shell and the tabs sit on it, which
    // is what makes them read as the page's own navigation rather than as a
    // filter control floating above the content.
    //
    // The tabs wrap rather than scroll. A horizontal scroller here was worse
    // than the problem it solved: `overflow-x: auto` computes `overflow-y`
    // to `auto` as well, and the active tab is taller than the row by the
    // pixel that pulls its underline onto the rule — so the browser clipped
    // the indicator and offered a vertical scrollbar for it. Four short
    // labels fit on one line at 390px, and a fifth wrapping to a second line
    // is a better failure than an indicator nobody can see.
    <nav aria-label={ariaLabel} className="border-border -mx-4 border-b px-4">
      <ul className="-mb-px flex flex-wrap items-center gap-x-5 text-sm">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <li key={tab.id}>
              <Link
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "-mb-px block border-b-2 py-2.5 whitespace-nowrap transition-colors",
                  "focus-visible:ring-ring-halo rounded-sm outline-none focus-visible:ring-[3px]",
                  isActive
                    ? "border-foreground text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
                href={tab.href}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
