import type { FileResource, FileSearchMeta } from "@sokosumi/core-client";

/**
 * Folding a newly loaded page into the list already on screen.
 *
 * Pulled out of the component because it is the whole of a defect and
 * none of the rendering. `drive-all-files-panel.tsx` appended every page
 * unconditionally while taking `meta` from the fresh response, so the
 * numerator was an accumulated total and the denominator was a fresh
 * window count.
 *
 * The server had already said what happened. A result window lives for
 * `SEARCH_SESSION_TTL_MS` — five minutes — and when the cursor's window
 * is gone the search is re-run from scratch and the response comes back
 * with `restarted: true`. Following the new cursor really does yield the
 * rest with no repeats; the restart is sound. Nothing in the web app
 * read the flag.
 *
 * So five minutes after a search, or after browsing a file list, pressing
 * Load more showed the first page twice and a count that cannot exist —
 * "Showing 40 of 23" on twenty-three documents, then "Showing 43 of 23".
 * No error and no message, and the documents being paged toward stayed
 * missing.
 *
 * Browsing hits this the same way and is the likelier route: the panel
 * chooses `relevance` or `modified` from whether a query is present, and
 * this is the only page-append in the web app, so someone scrolling a
 * file list without ever typing anything meets it too. One path serves
 * both; there is deliberately no special case for a query.
 */

export interface LoadedFilePage {
  items: FileResource[];
  search: FileSearchMeta;
}

export interface MergedFilePage {
  items: FileResource[];
  meta: FileSearchMeta;
  /**
   * True when this page replaced the list rather than extending it.
   *
   * Drives the notice beside Load more. Carried out rather than being
   * re-read from `meta` at the call site so that the component's flag and
   * the list it describes are decided in one place and cannot disagree.
   */
  restarted: boolean;
}

/**
 * Append, unless the server says the window was rebuilt.
 *
 * On a restart the page is the first page of a *new* window, so the items
 * already on screen belong to a window that no longer exists. Keeping
 * them duplicates rows and makes the count the sum of two different
 * windows. Replacing is what makes "Showing N of M" true again: after
 * this, N is this window's items and M is this window's count.
 */
export function mergeLoadedFilePage(
  currentItems: FileResource[],
  page: LoadedFilePage,
): MergedFilePage {
  if (page.search.restarted) {
    return { items: page.items, meta: page.search, restarted: true };
  }

  return {
    // A later page can be short or empty when entries changed. That is
    // the snapshot working, not an error.
    items: [...currentItems, ...page.items],
    meta: page.search,
    restarted: false,
  };
}
