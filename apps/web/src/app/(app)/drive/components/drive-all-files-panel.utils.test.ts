import { describe, expect, it } from "vitest";

import type {
  FileResource,
  FileSearchMeta,
} from "@/lib/clients/generated/core";

import { mergeLoadedFilePage } from "./drive-all-files-panel.utils";

/**
 * Five minutes after a search — or after browsing a file list — pressing
 * Load more showed the first page twice and a count that cannot exist.
 *
 * Measured through the interface on twenty-three documents: "Showing 40
 * of 23" with twenty rows rendered twice, and the three being paged
 * toward still missing. Press again and it read "Showing 43 of 23". No
 * error and no message.
 *
 * The server was already honest. A result window lives for
 * `SEARCH_SESSION_TTL_MS`, five minutes, and when the cursor's window is
 * gone the search is re-run and the response carries `restarted: true`.
 * Following the new cursor really does yield the remainder with no
 * repeats — the restart is sound. Nothing in the web app read the flag,
 * and the panel appended every page while taking `meta` from the fresh
 * response, so the numerator accumulated across two different windows
 * and the denominator did not.
 */

function meta(overrides: Partial<FileSearchMeta> = {}): FileSearchMeta {
  return {
    rankingMode: "deterministic",
    rankingFallback: null,
    resultWindowLimit: 120,
    windowCount: 23,
    remainingWindowCount: 3,
    truncated: false,
    hasMore: true,
    nextCursor: "cursor-2",
    restarted: false,
    indexCoverage: { indexed: 23, processing: 0, unsupported: 0 },
    ...overrides,
  } as FileSearchMeta;
}

function items(...ids: string[]): FileResource[] {
  return ids.map((id) => ({ id }) as FileResource);
}

describe("folding a loaded page into the list on screen", () => {
  it("appends an ordinary page and lets the count grow", () => {
    const merged = mergeLoadedFilePage(items("a", "b"), {
      items: items("c", "d"),
      search: meta(),
    });

    expect(merged.items.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
    expect(merged.restarted).toBe(false);
    expect(merged.meta.windowCount).toBe(23);
  });

  it("replaces the list when the window was rebuilt", () => {
    /**
     * The defect, at its smallest. The page is the first page of a *new*
     * window, so the rows already on screen belong to a window that no
     * longer exists. Appending is what produced twenty duplicated rows.
     */
    const merged = mergeLoadedFilePage(items("a", "b", "c"), {
      items: items("a", "b"),
      search: meta({ restarted: true }),
    });

    expect(merged.items.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("takes the count from the response, not from the sum", () => {
    /**
     * "Showing 40 of 23" is this assertion failing. The numerator is the
     * length of the list the panel renders, so after a restart it has to
     * be this window's items and not the two windows added together.
     */
    const onScreen = items(...Array.from({ length: 20 }, (_, i) => `old-${i}`));
    const merged = mergeLoadedFilePage(onScreen, {
      items: items(...Array.from({ length: 20 }, (_, i) => `new-${i}`)),
      search: meta({ restarted: true, windowCount: 23 }),
    });

    expect(merged.items).toHaveLength(20);
    expect(merged.items.length).toBeLessThanOrEqual(merged.meta.windowCount);
    // The impossible count, stated the way the screen states it.
    expect(`Showing ${merged.items.length} of ${merged.meta.windowCount}`).toBe(
      "Showing 20 of 23",
    );
  });

  it("flags the restart so the notice can be shown", () => {
    // The flag is what drives "This list was refreshed. Showing it from
    // the start." A silent replacement would be its own small lie: rows
    // would vanish from the screen with no account of why.
    const merged = mergeLoadedFilePage(items("a"), {
      items: items("a"),
      search: meta({ restarted: true }),
    });

    expect(merged.restarted).toBe(true);
  });

  it("does not flag an ordinary page", () => {
    // The notice has to be absent when nothing happened, or it stops
    // meaning anything.
    const merged = mergeLoadedFilePage(items("a"), {
      items: items("b"),
      search: meta(),
    });

    expect(merged.restarted).toBe(false);
  });

  it("treats a browsed list exactly like a searched one", () => {
    /**
     * The likelier route, and the one with no query in it. The panel
     * picks `relevance` or `modified` from whether a query is present,
     * and this is the only page-append in the web app, so someone
     * scrolling a file list without typing anything meets the same
     * defect. There is deliberately no query-shaped special case here —
     * this asserts that absence.
     */
    const browsed = mergeLoadedFilePage(items("a", "b"), {
      items: items("a", "b"),
      search: meta({ restarted: true, windowCount: 23 }),
    });

    expect(browsed.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(browsed.restarted).toBe(true);
  });

  it("keeps an empty later page from emptying the list", () => {
    // A short or empty page is the snapshot working, not a restart, and
    // must not clear what is on screen.
    const merged = mergeLoadedFilePage(items("a", "b"), {
      items: [],
      search: meta({ hasMore: false, nextCursor: null }),
    });

    expect(merged.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(merged.restarted).toBe(false);
  });
});
