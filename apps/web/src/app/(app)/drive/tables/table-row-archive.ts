import type { TableRow } from "@sokosumi/core-client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { type createTableMutations, isTableRejection } from "./table-mutations";
import { tableError } from "./table-value";

type Page = { rows: TableRow[]; total: number };
type Patch = ReturnType<typeof archivePatch>;
type Translate = NonNullable<Parameters<typeof tableError>[1]> &
  ((
    key: "errors.archiveRows" | "errors.restoreRows",
    values: { count: number; reason: string },
  ) => string);

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

/**
 * Sends an archive or restore. A rejected one did not commit, and the refresh
 * after it puts the rows back: its message counts them before it gives the
 * reason. A failure that may have committed keeps its own message and Retry,
 * and so does a missing table or row, which does not come back. `slot` is the
 * one `runMove` looks up to offer Retry.
 */
export async function saveArchive<R>(
  t: Translate,
  slot: string,
  patch: Patch,
  mutate: ReturnType<typeof createTableMutations>,
  send: (body: { patch: Patch; key: string }) => Promise<R>,
) {
  try {
    return await mutate(slot, { patch }, send);
  } catch (error) {
    if (!isTableRejection(error) || isMissing(error)) throw error;
    const key = patch[0]?.archived
      ? "errors.archiveRows"
      : "errors.restoreRows";
    throw new Error(
      t(key, { count: patch.length, reason: tableError(error, t) }),
    );
  }
}

function isMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "error" in error &&
    error.error === "NotFound"
  );
}
