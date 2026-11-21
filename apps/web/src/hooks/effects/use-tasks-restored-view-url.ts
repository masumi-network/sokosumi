"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect } from "react";

import { hasTasksViewParams } from "@/app/tasks/utils/tasks-filters";

/**
 * The view this tab saved last, per workspace. A visited copy of the page can
 * carry an older saved view; this one is newer, so it wins over it.
 */
const lastSavedViewByWorkspace = new Map<string, string>();

function workspaceKey(activeOrganizationId: string | null): string {
  return activeOrganizationId ?? "personal";
}

export function withTasksView(
  searchParams: URLSearchParams,
  viewQuery: string,
): URLSearchParams {
  const merged = new URLSearchParams(searchParams.toString());
  for (const [key, value] of new URLSearchParams(viewQuery)) {
    merged.set(key, value);
  }
  return merged;
}

/**
 * Records a workspace's latest saved Tasks view in this tab. Returns `true`
 * when the value changed and should be persisted to the server.
 */
export function rememberSavedTasksView(
  activeOrganizationId: string | null,
  viewQuery: string,
): boolean {
  const key = workspaceKey(activeOrganizationId);
  if (lastSavedViewByWorkspace.get(key) === viewQuery) {
    return false;
  }
  lastSavedViewByWorkspace.set(key, viewQuery);
  return true;
}

/** Clears a saved view entry if it is still the latest value for that workspace. */
export function forgetSavedTasksView(
  activeOrganizationId: string | null,
  viewQuery: string,
): void {
  const key = workspaceKey(activeOrganizationId);
  if (lastSavedViewByWorkspace.get(key) === viewQuery) {
    lastSavedViewByWorkspace.delete(key);
  }
}

/**
 * Writes a server-restored Tasks view into the address bar before paint via
 * `window.history.replaceState(null, "", ...)`, or loads a newer view this tab
 * saved last via `router.replace`.
 */
export function useTasksRestoredViewUrl(
  restoredQuery: string | null,
  activeOrganizationId: string | null,
): void {
  const router = useRouter();

  // Writes the opened view into the address bar, so a reload or a shared link
  // shows it. No navigation: the page already renders it.
  useLayoutEffect(() => {
    if (restoredQuery === null) return;
    const current = new URLSearchParams(window.location.search);
    if (hasTasksViewParams(current)) return;
    const newer = lastSavedViewByWorkspace.get(
      workspaceKey(activeOrganizationId),
    );
    if (newer !== undefined && newer !== restoredQuery) {
      // A visited copy of the page from before this tab's last save: load
      // the newer view. It names a scope, so the server does not restore.
      router.replace(
        `${window.location.pathname}?${withTasksView(current, newer)}`,
      );
      return;
    }
    if (!restoredQuery) return;
    // A null state lets Next adopt the new URL into useSearchParams; its own
    // state would make Next skip the sync and later restore the bare URL.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${withTasksView(current, restoredQuery)}${window.location.hash}`,
    );
  }, [activeOrganizationId, restoredQuery, router]);
}
