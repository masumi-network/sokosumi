import type { TableRow } from "@sokosumi/core-client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

type Page = { rows: TableRow[]; total: number };

/** The batch patch that archives or restores the selected rows of a page. */
export function archivePatch(
  page: Pick<Page, "rows"> | undefined,
  selected: string[],
  archived: boolean,
) {
  return (page?.rows ?? [])
    .filter((row) => selected.includes(row.id))
    .map((row) => ({ id: row.id, version: row.version, archived }));
}

/**
 * Takes rows off a cached page the moment they leave it for the other archive
 * mode. A load already under way holds the page from before, so it is
 * cancelled; a failed save refreshes and brings the rows back.
 */
export function hideRows(cache: QueryClient, key: QueryKey, ids: string[]) {
  void cache.cancelQueries({ queryKey: key });
  cache.setQueryData<Page>(key, (page) => {
    if (!page) return page;
    const rows = page.rows.filter((row) => !ids.includes(row.id));
    return {
      ...page,
      rows,
      total: page.total - (page.rows.length - rows.length),
    };
  });
}
