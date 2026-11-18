import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

interface BackHistoryEntry {
  key: string;
  url: string | null;
  sameDocument: boolean;
}

/** The part of the Navigation API (`window.navigation`) back needs. */
export interface BackHistory {
  currentEntry: BackHistoryEntry | null;
  entries(): BackHistoryEntry[];
}

function browserHistory(): BackHistory | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { navigation?: BackHistory }).navigation;
}

/** True when the entry before this page is `href`'s page, in this document. */
function cameFrom(href: string, history: BackHistory | undefined): boolean {
  const current = history?.currentEntry;
  if (!history || !current?.url) return false;
  const entries = history.entries();
  const previous = entries[entries.findIndex((e) => e.key === current.key) - 1];
  if (!previous?.sameDocument || !previous.url) return false;
  return new URL(previous.url).pathname === new URL(href, current.url).pathname;
}

/**
 * Back to a parent page the way a native app goes back: when the reader came
 * from the parent, pop to it (the same step as the swipe-back gesture, with
 * its view and scroll intact). Otherwise swap this page for the parent, so a
 * swipe back afterwards never reopens the page just left.
 *
 * Never pushes: a pushed parent leaves this page behind it in history.
 */
export function navigateBack(
  router: AppRouterInstance,
  href: string,
  history: BackHistory | undefined = browserHistory(),
): void {
  if (cameFrom(href, history)) router.back();
  else router.replace(href);
}
