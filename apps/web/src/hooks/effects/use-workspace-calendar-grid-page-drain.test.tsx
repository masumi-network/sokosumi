import type { WorkspaceCalendarEntry } from "@sokosumi/core-client";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  useWorkspaceCalendarGridPageDrain,
  type WorkspaceCalendarRequestedPage,
} from "@/hooks/effects/use-workspace-calendar-grid-page-drain";

describe("useWorkspaceCalendarGridPageDrain", () => {
  it("drains remaining pages in month/week views, skips agenda or errors, and re-drains when server items change", () => {
    const itemsA: WorkspaceCalendarEntry[] = [];
    const itemsB: WorkspaceCalendarEntry[] = [];
    const loadNextPage = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({
        view,
        items,
        nextCursor,
        loadMoreError,
      }: {
        view: "month" | "week" | "agenda";
        items: WorkspaceCalendarEntry[];
        nextCursor: string | null;
        loadMoreError: boolean;
      }) => {
        const requestedPageRef = useRef<WorkspaceCalendarRequestedPage | null>(
          null,
        );
        useWorkspaceCalendarGridPageDrain({
          view,
          items,
          nextCursor,
          loadMoreError,
          loadNextPage,
          requestedPageRef,
        });
      },
      {
        initialProps: {
          view: "agenda" as "month" | "week" | "agenda",
          items: itemsA,
          nextCursor: "cursor-1" as string | null,
          loadMoreError: false,
        },
      },
    );

    expect(loadNextPage).not.toHaveBeenCalled();

    rerender({
      view: "week",
      items: itemsA,
      nextCursor: "cursor-1",
      loadMoreError: false,
    });
    expect(loadNextPage).toHaveBeenCalledTimes(1);

    // Same cursor and same server items array: does not re-request.
    rerender({
      view: "month",
      items: itemsA,
      nextCursor: "cursor-1",
      loadMoreError: false,
    });
    expect(loadNextPage).toHaveBeenCalledTimes(1);

    // Refreshed server snapshot reusing the same cursor string drains again.
    rerender({
      view: "month",
      items: itemsB,
      nextCursor: "cursor-1",
      loadMoreError: false,
    });
    expect(loadNextPage).toHaveBeenCalledTimes(2);

    // Next cursor with loadMoreError stays paused.
    rerender({
      view: "month",
      items: itemsB,
      nextCursor: "cursor-2",
      loadMoreError: true,
    });
    expect(loadNextPage).toHaveBeenCalledTimes(2);

    // Clearing the error resumes draining cursor-2.
    rerender({
      view: "month",
      items: itemsB,
      nextCursor: "cursor-2",
      loadMoreError: false,
    });
    expect(loadNextPage).toHaveBeenCalledTimes(3);
  });
});
