"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { useSession } from "@/lib/auth/auth.client";

import {
  isProjectScopedPath,
  projectPageSection,
  readProjectScope,
  scopedHref,
  switchScopeHref,
} from "./project-scope-href";
import { useMarkedProjectId } from "./project-scope-marker";

const scopeListeners = new Set<() => void>();
let activeStorageKey: string | null = null;
let workspaceTransition: {
  pathname: string;
  projectId: string | null;
} | null = null;

function subscribeScope(listener: () => void) {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

function readRememberedScope(key: string | null): string | null {
  if (!key) return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRememberedScope(key: string | null, projectId: string | null) {
  if (!key || readRememberedScope(key) === projectId) return;
  try {
    if (projectId) sessionStorage.setItem(key, projectId);
    else sessionStorage.removeItem(key);
  } catch {
    // Blocked storage must not prevent navigation or explicit selection.
    return;
  }
  for (const listener of scopeListeners) listener();
}

/** URL and detail-page scope wins; neutral pages retain the last selection. */
export function useProjectScope() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const markedProjectId = useMarkedProjectId(pathname);
  // Null outside the App Router, as in component tests.
  const routeProjectId =
    readProjectScope(pathname, searchParams ?? new URLSearchParams()) ??
    markedProjectId ??
    null;
  const hasRouteScope =
    isProjectScopedPath(pathname) ||
    projectPageSection(pathname) !== null ||
    markedProjectId !== undefined ||
    pathname === "/projects";
  const { data: session, isPending, error } = useSession();
  const storageKey =
    session && !isPending && !error
      ? JSON.stringify([
          "sokosumi.project-scope.v1",
          session.user.id,
          session.session.activeOrganizationId ?? null,
        ])
      : null;
  const rememberedProjectId = useSyncExternalStore(
    subscribeScope,
    () => readRememberedScope(storageKey),
    () => null,
  );

  // Synchronize the browser preference only on pages that own a scope.
  // Chats and loading detail pages must not erase the last selection.
  useEffect(() => {
    if (!storageKey) return;
    // Workspace switching briefly retains the previous workspace's URL.
    // Ignore it, and the guard's cleanup, until a new project or page is chosen.
    if (activeStorageKey && activeStorageKey !== storageKey) {
      workspaceTransition = { pathname, projectId: routeProjectId };
    }
    activeStorageKey = storageKey;
    if (
      workspaceTransition &&
      (workspaceTransition.pathname !== pathname ||
        (routeProjectId !== null &&
          routeProjectId !== workspaceTransition.projectId))
    ) {
      workspaceTransition = null;
    }
    if (hasRouteScope && !workspaceTransition) {
      writeRememberedScope(storageKey, routeProjectId);
    }
  }, [hasRouteScope, pathname, routeProjectId, storageKey]);

  const projectId = hasRouteScope ? routeProjectId : rememberedProjectId;

  return {
    projectId,
    /** Remember an explicit choice even on a page whose URL has no scope. */
    rememberProjectId: (nextProjectId: string | null) => {
      writeRememberedScope(storageKey, nextProjectId);
    },
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
    scope.rememberProjectId(nextProjectId);
    if (nextProjectId === scope.projectId) return;
    router.push(scope.switchHref(nextProjectId));
  }

  return { ...scope, select };
}
