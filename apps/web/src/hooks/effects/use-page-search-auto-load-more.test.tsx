import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePageSearchAutoLoadMore } from "./use-page-search-auto-load-more";

describe("usePageSearchAutoLoadMore", () => {
  it("requests each cursor once while searching, uses the latest loadMore callback, and resets deduplication when search clears", () => {
    const firstLoadMore = vi.fn();
    const secondLoadMore = vi.fn();

    const { rerender } = renderHook(
      ({
        searching,
        cursor,
        busy,
        loadMore,
      }: {
        searching: boolean;
        cursor: string | null | undefined;
        busy: boolean;
        loadMore: () => unknown;
      }) => usePageSearchAutoLoadMore(searching, cursor, busy, loadMore),
      {
        initialProps: {
          searching: false,
          cursor: "cursor-1" as string | null | undefined,
          busy: false,
          loadMore: firstLoadMore,
        },
      },
    );

    // Idle when not searching.
    expect(firstLoadMore).not.toHaveBeenCalled();

    // Waiting while busy.
    rerender({
      searching: true,
      cursor: "cursor-1",
      busy: true,
      loadMore: firstLoadMore,
    });
    expect(firstLoadMore).not.toHaveBeenCalled();

    // Requests cursor-1 once busy clears.
    rerender({
      searching: true,
      cursor: "cursor-1",
      busy: false,
      loadMore: firstLoadMore,
    });
    expect(firstLoadMore).toHaveBeenCalledTimes(1);

    // Does not re-request the same cursor when loadMore changes or busy toggles.
    rerender({
      searching: true,
      cursor: "cursor-1",
      busy: true,
      loadMore: secondLoadMore,
    });
    rerender({
      searching: true,
      cursor: "cursor-1",
      busy: false,
      loadMore: secondLoadMore,
    });
    expect(firstLoadMore).toHaveBeenCalledTimes(1);
    expect(secondLoadMore).not.toHaveBeenCalled();

    // Advancing to cursor-2 invokes the latest loadMore callback.
    rerender({
      searching: true,
      cursor: "cursor-2",
      busy: false,
      loadMore: secondLoadMore,
    });
    expect(secondLoadMore).toHaveBeenCalledTimes(1);

    // Clearing search resets deduplication so the same cursor can be requested again.
    rerender({
      searching: false,
      cursor: "cursor-2",
      busy: false,
      loadMore: secondLoadMore,
    });
    rerender({
      searching: true,
      cursor: "cursor-2",
      busy: false,
      loadMore: secondLoadMore,
    });
    expect(secondLoadMore).toHaveBeenCalledTimes(2);
  });

  it("does not request when cursor is null or undefined", () => {
    const loadMore = vi.fn();
    const { rerender } = renderHook(
      ({ cursor }: { cursor: string | null | undefined }) =>
        usePageSearchAutoLoadMore(true, cursor, false, loadMore),
      { initialProps: { cursor: null as string | null | undefined } },
    );

    expect(loadMore).not.toHaveBeenCalled();

    rerender({ cursor: undefined });
    expect(loadMore).not.toHaveBeenCalled();
  });
});
