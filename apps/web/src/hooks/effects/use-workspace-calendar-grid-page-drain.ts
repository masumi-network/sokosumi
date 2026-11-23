"use client";

import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";
import { type RefObject, useEffect } from "react";

export interface WorkspaceCalendarRequestedPage {
  cursor: string;
  items: WorkspaceCalendarEntry[];
}

interface UseWorkspaceCalendarGridPageDrainOptions {
  view: "month" | "week" | "agenda";
  items: WorkspaceCalendarEntry[];
  nextCursor: string | null;
  loadMoreError: boolean;
  loadNextPage: () => Promise<void>;
  requestedPageRef: RefObject<WorkspaceCalendarRequestedPage | null>;
}

/**
 * Drains remaining paginated calendar pages while showing a month/week grid so
 * every event in the visible period is loaded.
 */
export function useWorkspaceCalendarGridPageDrain({
  view,
  items,
  nextCursor,
  loadMoreError,
  loadNextPage,
  requestedPageRef,
}: UseWorkspaceCalendarGridPageDrainOptions): void {
  // Month/week grids must show every event: a day holding three of its five
  // events looks complete. Drain the remaining pages as soon as one appears.
  useEffect(() => {
    const requested = requestedPageRef.current;
    if (
      view === "agenda" ||
      !nextCursor ||
      loadMoreError ||
      (requested?.cursor === nextCursor && requested.items === items)
    ) {
      return;
    }
    requestedPageRef.current = { cursor: nextCursor, items };
    void loadNextPage();
  }, [view, items, nextCursor, loadMoreError, loadNextPage]);
}
