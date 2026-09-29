"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  readProjectScope,
  scopedHref,
  switchScopeHref,
} from "./project-scope-href";
import { useMarkedProjectId } from "./project-scope-marker";

/**
 * The reader's project scope, read from the URL, or on a task or schedule
 * detail page from the project that page marked.
 */
export function useProjectScope() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const markedProjectId = useMarkedProjectId(pathname);
  // Null outside the App Router, as in component tests.
  const projectId =
    readProjectScope(pathname, searchParams ?? new URLSearchParams()) ??
    markedProjectId;

  return {
    projectId,
    /** A navigation link that keeps the current scope. */
    hrefFor: (href: string) => scopedHref(href, projectId),
    /** Where choosing a project, or the workspace as null, leads. */
    switchHref: (nextProjectId: string | null) =>
      switchScopeHref(pathname, nextProjectId),
  };
}

/**
 * Sends focus back to the switcher when Create project closes. Without it,
 * focus falls to the page body, because the menu that opened the dialog is
 * gone.
 */
export function returnFocusTo(opener: HTMLElement | null) {
  return (event: Event) => {
    if (!opener) return;
    // A chat room hides some openers, and a navigation can remove one.
    const target = isVisible(opener) ? opener : firstVisibleHeaderControl();
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
}

function isVisible(element: HTMLElement): boolean {
  return element.isConnected && element.getClientRects().length > 0;
}

/** The header's first visible control: a fallback that is always there. */
function firstVisibleHeaderControl(): HTMLElement | null {
  const controls = document.querySelectorAll<HTMLElement>(
    "header a[href], header button",
  );
  return Array.from(controls).find(isVisible) ?? null;
}

/** Navigate when the reader chooses a different project scope. */
export function useProjectScopeSwitch() {
  const router = useRouter();
  const scope = useProjectScope();

  function select(nextProjectId: string | null) {
    // Re-picking the scope in hand would only wipe the page's own filters.
    if (nextProjectId === scope.projectId) return;
    router.push(scope.switchHref(nextProjectId));
  }

  return { ...scope, select };
}
