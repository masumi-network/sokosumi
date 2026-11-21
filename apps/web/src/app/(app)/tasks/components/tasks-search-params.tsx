"use client";

import { useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { saveTasksView } from "@/app/tasks/actions";
import {
  hasTasksViewParams,
  pickTasksViewQuery,
} from "@/app/tasks/utils/tasks-filters";
import {
  forgetSavedTasksView,
  rememberSavedTasksView,
  useTasksRestoredViewUrl,
  withTasksView,
} from "@/hooks/effects/use-tasks-restored-view-url";

interface RestoredView {
  query: string | null;
}

const RestoredViewContext = createContext<RestoredView>({ query: null });

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
      ? withTasksView(current, query)
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
  const value = useMemo(() => ({ query: restoredQuery }), [restoredQuery]);

  useTasksRestoredViewUrl(restoredQuery, activeOrganizationId);

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
  if (rememberSavedTasksView(activeOrganizationId, viewQuery)) {
    // Sent before the navigation: a navigation lets an action already sent
    // finish, but holds a later one back until the new board has loaded.
    // Server actions run one at a time, so the last change is the last save.
    const forget = () => {
      forgetSavedTasksView(activeOrganizationId, viewQuery);
    };
    saveTasksView(viewQuery, activeOrganizationId)
      .then((saved) => {
        if (!saved) forget();
      })
      .catch((error: unknown) => {
        forget();
        console.error("Failed to save the Tasks view", error);
      });
  }

  const nextQuery = nextSearchParams.toString();
  router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
}
