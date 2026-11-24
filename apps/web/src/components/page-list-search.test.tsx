import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  PageListSearchContext,
  PageSearchRows,
  usePageListSearch,
  usePageSearchPagination,
  usePageSearchQuery,
} from "./page-list-search";

interface SearchContextValue {
  query: string;
  setQuery?: (value: string) => void;
  register: (hits: number, hasMore: boolean) => () => void;
}

function createWrapper(value: SearchContextValue | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PageListSearchContext.Provider value={value}>
        {children}
      </PageListSearchContext.Provider>
    );
  };
}

describe("page-list-search", () => {
  describe("usePageSearchQuery", () => {
    it("returns an empty string outside PageListSearchContext", () => {
      const { result } = renderHook(() => usePageSearchQuery());
      expect(result.current).toBe("");
    });

    it("returns the trimmed query inside PageListSearchContext", () => {
      const register = vi.fn(() => vi.fn());
      const { result } = renderHook(() => usePageSearchQuery(), {
        wrapper: createWrapper({ query: "  launch  ", register }),
      });
      expect(result.current).toBe("launch");
    });
  });

  describe("usePageListSearch", () => {
    const items = [
      { id: "1", title: "Alpha", tag: "launch" },
      { id: "2", title: "Launch Plan", tag: "roadmap" },
      { id: "3", title: "Gamma", tag: "archive" },
    ];

    it("returns all items unchanged outside PageListSearchContext", () => {
      const { result } = renderHook(() =>
        usePageListSearch(items, (item) => ({
          primary: [item.title],
          secondary: [item.tag],
        })),
      );
      expect(result.current).toBe(items);
    });

    it("ranks matching items, registers hit counts, and cleans up on change and unmount", () => {
      const cleanups: Array<ReturnType<typeof vi.fn>> = [];
      const register = vi.fn((_hits: number, _hasMore: boolean) => {
        const cleanup = vi.fn();
        cleanups.push(cleanup);
        return cleanup;
      });

      let contextValue: SearchContextValue = { query: "", register };
      const { result, rerender, unmount } = renderHook(
        () =>
          usePageListSearch(items, (item) => ({
            primary: [item.title],
            secondary: [item.tag],
          })),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <PageListSearchContext.Provider value={contextValue}>
              {children}
            </PageListSearchContext.Provider>
          ),
        },
      );

      expect(result.current).toBe(items);
      expect(register).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenLastCalledWith(3, false);

      contextValue = { query: "launch", register };
      rerender();

      expect(result.current.map((item) => item.id)).toEqual(["2", "1"]);
      expect(cleanups[0]).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenCalledTimes(2);
      expect(register).toHaveBeenLastCalledWith(2, false);

      unmount();
      expect(cleanups[1]).toHaveBeenCalledTimes(1);
    });
  });

  describe("PageSearchRows", () => {
    it("filters and ranks rendered row contents against the context query", () => {
      const register = vi.fn(() => vi.fn());
      render(
        <PageListSearchContext.Provider value={{ query: "beta", register }}>
          <ul>
            <PageSearchRows
              rows={[
                {
                  primary: ["Alpha"],
                  secondary: ["beta tag"],
                  content: <li key="alpha">Alpha</li>,
                },
                {
                  primary: ["Beta title"],
                  content: <li key="beta">Beta title</li>,
                },
                {
                  primary: ["Gamma"],
                  content: <li key="gamma">Gamma</li>,
                },
              ]}
            />
          </ul>
        </PageListSearchContext.Provider>,
      );

      expect(
        screen.getAllByRole("listitem").map((node) => node.textContent),
      ).toEqual(["Beta title", "Alpha"]);
      expect(register).toHaveBeenCalledWith(2, false);
    });
  });

  describe("usePageSearchPagination", () => {
    it("registers a partial marker only while a cursor exists and cleans up when cleared or unmounted", () => {
      const cleanups: Array<ReturnType<typeof vi.fn>> = [];
      const register = vi.fn((_hits: number, _hasMore: boolean) => {
        const cleanup = vi.fn();
        cleanups.push(cleanup);
        return cleanup;
      });
      const loadMore = vi.fn();

      const { rerender, unmount } = renderHook(
        ({ cursor }: { cursor: string | null }) =>
          usePageSearchPagination(cursor, false, loadMore),
        {
          initialProps: { cursor: null as string | null },
          wrapper: createWrapper({ query: "", register }),
        },
      );

      expect(register).not.toHaveBeenCalled();

      rerender({ cursor: "cursor-1" });
      expect(register).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenLastCalledWith(0, true);

      // Keeping a truthy cursor keeps the same partial registration active.
      rerender({ cursor: "cursor-2" });
      expect(register).toHaveBeenCalledTimes(1);
      expect(cleanups[0]).not.toHaveBeenCalled();

      rerender({ cursor: null });
      expect(cleanups[0]).toHaveBeenCalledTimes(1);

      rerender({ cursor: "cursor-3" });
      expect(register).toHaveBeenCalledTimes(2);
      unmount();
      expect(cleanups[1]).toHaveBeenCalledTimes(1);
    });

    it("auto-loads each cursor once while searching, advances on new cursors, and resets when search clears", () => {
      const register = vi.fn(() => vi.fn());
      const firstLoadMore = vi.fn();
      const secondLoadMore = vi.fn();

      let contextValue: SearchContextValue = { query: "", register };
      const { rerender } = renderHook(
        ({
          cursor,
          busy,
          loadMore,
        }: {
          cursor: string | null;
          busy: boolean;
          loadMore: () => unknown;
        }) => usePageSearchPagination(cursor, busy, loadMore),
        {
          initialProps: {
            cursor: "cursor-1" as string | null,
            busy: false,
            loadMore: firstLoadMore,
          },
          wrapper: ({ children }: { children: ReactNode }) => (
            <PageListSearchContext.Provider value={contextValue}>
              {children}
            </PageListSearchContext.Provider>
          ),
        },
      );

      // Not searching yet.
      expect(firstLoadMore).not.toHaveBeenCalled();

      // Start searching while busy: waits until not busy.
      contextValue = { query: "invoice", register };
      rerender({ cursor: "cursor-1", busy: true, loadMore: firstLoadMore });
      expect(firstLoadMore).not.toHaveBeenCalled();

      // Busy clears: loads cursor-1 once.
      rerender({ cursor: "cursor-1", busy: false, loadMore: firstLoadMore });
      expect(firstLoadMore).toHaveBeenCalledTimes(1);

      // Changing loadMore identity or toggling busy for the same cursor does not re-request.
      rerender({ cursor: "cursor-1", busy: true, loadMore: secondLoadMore });
      rerender({ cursor: "cursor-1", busy: false, loadMore: secondLoadMore });
      expect(firstLoadMore).toHaveBeenCalledTimes(1);
      expect(secondLoadMore).not.toHaveBeenCalled();

      // Advancing to cursor-2 invokes the latest loadMore callback.
      rerender({ cursor: "cursor-2", busy: false, loadMore: secondLoadMore });
      expect(secondLoadMore).toHaveBeenCalledTimes(1);

      // Clearing search resets deduplication so searching again re-requests the cursor.
      contextValue = { query: "   ", register };
      rerender({ cursor: "cursor-2", busy: false, loadMore: secondLoadMore });
      expect(secondLoadMore).toHaveBeenCalledTimes(1);

      contextValue = { query: "invoice", register };
      rerender({ cursor: "cursor-2", busy: false, loadMore: secondLoadMore });
      expect(secondLoadMore).toHaveBeenCalledTimes(2);
    });
  });
});
