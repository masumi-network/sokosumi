"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
} from "react";
import { saveTasksView } from "@/app/tasks/actions";
import {
  hasTasksViewParams,
  pickTasksViewQuery,
} from "@/app/tasks/utils/tasks-filters";

/**
 * The view this tab saved last, per workspace. A visited copy of the page can
 * carry an older saved view; this one is newer, so it wins over it.
 */
const lastSavedViewByWorkspace = new Map<string, string>();

function workspaceKey(activeOrganizationId: string | null) {
  return activeOrganizationId ?? "personal";
}

interface RestoredView {
  query: string | null;
}

const RestoredViewContext = createContext<RestoredView>({ query: null });

function withView(searchParams: URLSearchParams, viewQuery: string) {
  const merged = new URLSearchParams(searchParams.toString());
  for (const [key, value] of new URLSearchParams(viewQuery)) {
    merged.set(key, value);
  }
  return merged;
}

/**
 * The page's search params, with the saved view the server opened in place of
 * a URL that names none. Every Tasks reader of the URL goes through it, so the
 * chips and the board agree before the URL catches up.
 */
export function useTasksSearchParams(): URLSearchParams {
  const searchParams = useSearchParams();
  const { query } = useContext(RestoredViewContext);
  return useMemo(() => {
    const current = new URLSearchParams(searchParams.toString());
    return query && !hasTasksViewParams(current)
      ? withView(current, query)
      : current;
  }, [query, searchParams]);
}

interface TasksSearchParamsProviderProps {
  /**
   * The saved view the server opened when the URL named none: empty when
   * nothing was saved, null when the URL named a view itself.
   */
  restoredQuery: string | null;
  activeOrganizationId: string | null;
  children: ReactNode;
}

export function TasksSearchParamsProvider({
  restoredQuery,
  activeOrganizationId,
  children,
}: TasksSearchParamsProviderProps) {
  const router = useRouter();
  const value = useMemo(() => ({ query: restoredQuery }), [restoredQuery]);

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
      router.replace(`${window.location.pathname}?${withView(current, newer)}`);
      return;
    }
    if (!restoredQuery) return;
    // A null state lets Next adopt the new URL into useSearchParams; its own
    // state would make Next skip the sync and later restore the bare URL.
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?${withView(current, restoredQuery)}${window.location.hash}`,
    );
  }, [activeOrganizationId, restoredQuery, router]);

  return (
    <RestoredViewContext.Provider value={value}>
      {children}
    </RestoredViewContext.Provider>
  );
}

/**
 * Moves the Tasks page to new toolbar params and saves them as the reader's
 * view. Only the toolbar calls it, so arriving from a link never saves.
 */
export function replaceTasksQuery(
  router: { replace: (href: string) => void },
  pathname: string,
  nextSearchParams: URLSearchParams,
  activeOrganizationId: string | null,
) {
  const viewQuery = pickTasksViewQuery(nextSearchParams);
  const key = workspaceKey(activeOrganizationId);
  if (lastSavedViewByWorkspace.get(key) !== viewQuery) {
    lastSavedViewByWorkspace.set(key, viewQuery);
    // Sent before the navigation: a navigation lets an action already sent
    // finish, but holds a later one back until the new board has loaded.
    // Server actions run one at a time, so the last change is the last save.
    saveTasksView(viewQuery, activeOrganizationId).catch((error: unknown) => {
      if (lastSavedViewByWorkspace.get(key) === viewQuery) {
        lastSavedViewByWorkspace.delete(key);
      }
      console.error("Failed to save the Tasks view", error);
    });
  }

  const nextQuery = nextSearchParams.toString();
  router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
}
