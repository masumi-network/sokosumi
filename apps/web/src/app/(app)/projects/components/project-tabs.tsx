"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, Suspense, use, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

export interface ProjectTab {
  /** Stable key, also the value reported by `aria-controls`-free tab markup. */
  id: string;
  href: string;
  label: string;
  icon?: React.ReactNode;
  /**
   * Match this path and nothing below it.
   *
   * The overview tab needs it: its href is `/projects/:id`, which is a prefix
   * of every other tab *and* of `/projects/:id/edit`, so a prefix match lit
   * Overview up on pages that are not it.
   */
  exact?: boolean;
  /**
   * Show the tab only once this resolves true. Only this tab waits: the
   * others stay mounted, so focus and layout hold while it loads.
   */
  when?: Promise<boolean>;
}

/**
 * Which tab a path is in.
 *
 * Longest match wins, so `/projects/:id/studio` does not resolve to the
 * overview tab whose href is a prefix of every other one. Anything below a
 * tab's route — a future `/studio/settings`, say — still highlights its tab.
 * A route that belongs to no tab, such as `/projects/:id/edit`, highlights
 * nothing, which is why the overview tab is matched exactly.
 *
 * A tab's query (the newsletter's `?projectId=`) is not part of its path.
 */
export function activeProjectTabId(
  pathname: string,
  tabs: readonly ProjectTab[],
): string | null {
  let best: { id: string; path: string } | null = null;
  for (const tab of tabs) {
    const path = tab.href.split("?")[0] ?? tab.href;
    const matches = tab.exact
      ? pathname === path
      : pathname === path || pathname.startsWith(`${path}/`);
    if (!matches) continue;
    if (!best || path.length > best.path.length) best = { id: tab.id, path };
  }
  return best?.id ?? null;
}

/**
 * The project's subpages, as one underlined row directly above the content
 * they switch.
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
  // The server snapshot answers only while the page hydrates, so the row
  // carries the mark in the server's HTML and drops it right after. A page
  // Next kept in a hidden Activity attaches its links again when shown, by
  // then without the mark.
  const hydrating = useSyncExternalStore(
    subscribeToNothing,
    () => false,
    () => true,
  );

  return (
    // The tabs wrap rather than scroll. A horizontal scroller here was worse
    // than the problem it solved: `overflow-x: auto` computes `overflow-y`
    // to `auto` as well, and the active tab is taller than the row by the
    // pixel that pulls its underline onto the rule — so the browser clipped
    // the indicator and offered a vertical scrollbar for it. Four short
    // labels fit on one line at 390px, and a fifth wrapping to a second line
    // is a better failure than an indicator nobody can see.
    <nav
      aria-label={ariaLabel}
      className="border-border border-b"
      data-hydrating={hydrating || undefined}
    >
      <ul className="-mb-px flex flex-wrap items-center gap-x-5 text-sm">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          const item = (
            <li key={tab.id}>
              <Link
                ref={isActive ? focusIfDropped : undefined}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative -mb-px flex items-center gap-2 border-b-2 py-2.5 whitespace-nowrap transition-colors",
                  // No radius: the corners belong to the indicator too, and a
                  // rounded 2px bar under a word reads as a pill rather than
                  // as an underline.
                  "focus-visible:ring-ring focus-visible:inset-ring-ring outline-none focus-visible:ring-2 focus-visible:inset-ring-1",
                  isActive
                    ? "border-foreground text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
                href={tab.href}
              >
                {tab.icon}
                {tab.label}
                <TabPendingUnderline />
              </Link>
            </li>
          );
          return tab.when ? (
            <Suspense key={tab.id} fallback={null}>
              <ShowWhen when={tab.when}>{item}</ShowWhen>
            </Suspense>
          ) : (
            item
          );
        })}
      </ul>
    </nav>
  );
}

function subscribeToNothing() {
  return () => {};
}

/**
 * Each subpage renders its own row of tabs, so following a tab, or coming
 * back from Edit, removes the focused control with the old page and focus
 * falls to the body: a keyboard user starts again at the top of the app.
 * The current tab takes it back, only when nothing else holds it, and never
 * on a fresh load. A control in the page Next just hid still counts as
 * focused until the browser notices, so a hidden one counts as dropped.
 * Module level, so React calls it once per link rather than on every render.
 */
function focusIfDropped(link: HTMLAnchorElement | null) {
  if (!link || link.closest("[data-hydrating]")) return;
  const focused = link.ownerDocument.activeElement;
  const dropped =
    !focused ||
    focused === link.ownerDocument.body ||
    !focused.isConnected ||
    focused.checkVisibility?.() === false;
  if (dropped) link.focus({ preventScroll: true });
}

function ShowWhen({
  when,
  children,
}: {
  when: Promise<boolean>;
  children: ReactNode;
}) {
  return use(when) ? children : null;
}

/**
 * A subpage renders on the server, so a click can sit for most of a second
 * before the route changes. Until then the clicked tab's underline pulses in
 * place; always rendered, so nothing shifts.
 */
function TabPendingUnderline() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-pending={pending || undefined}
      className={cn(
        "bg-muted-foreground pointer-events-none absolute inset-x-0 -bottom-0.5 h-0.5 opacity-0 transition-opacity",
        pending && "opacity-100 motion-safe:animate-pulse",
      )}
    />
  );
}
