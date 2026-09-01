/**
 * Shared Files sort vocabulary and URL/query mapping (Browse, Recents, Tasks).
 *
 * Omit both params → each endpoint keeps its current default.
 * Recents: Core keeps activityAt primary; name/type are secondary only when
 * sent as sortBy (see Core drive-list-sort / drive-recents helpers).
 */

export const FILES_SORT_BY_VALUES = ["name", "date", "type"] as const;
export const FILES_SORT_ORDER_VALUES = ["asc", "desc"] as const;

export type FilesSortBy = (typeof FILES_SORT_BY_VALUES)[number];
export type FilesSortOrder = (typeof FILES_SORT_ORDER_VALUES)[number];

export interface FilesSortSelection {
  sortBy: FilesSortBy;
  sortOrder: FilesSortOrder;
}

export interface DriveListSortQuery {
  sortBy?: FilesSortBy;
  sortOrder?: FilesSortOrder;
}

function isFilesSortBy(value: string): value is FilesSortBy {
  return (FILES_SORT_BY_VALUES as readonly string[]).includes(value);
}

function isFilesSortOrder(value: string): value is FilesSortOrder {
  return (FILES_SORT_ORDER_VALUES as readonly string[]).includes(value);
}

export function defaultSortOrderForKey(sortBy: FilesSortBy): FilesSortOrder {
  return sortBy === "date" ? "desc" : "asc";
}

/** Visible control default when URL params are omitted (server default). */
export const DEFAULT_FILES_SORT_SELECTION: FilesSortSelection = {
  sortBy: "date",
  sortOrder: "desc",
};

export function toggleSortOrder(order: FilesSortOrder): FilesSortOrder {
  return order === "asc" ? "desc" : "asc";
}

export function effectiveFilesSortSelection(
  selection: FilesSortSelection | null,
): FilesSortSelection {
  return selection ?? DEFAULT_FILES_SORT_SELECTION;
}

/** Map a concrete selection to URL/storage; date+desc collapses to omit. */
export function toStoredFilesSortSelection(
  selection: FilesSortSelection,
): FilesSortSelection | null {
  if (
    selection.sortBy === DEFAULT_FILES_SORT_SELECTION.sortBy &&
    selection.sortOrder === DEFAULT_FILES_SORT_SELECTION.sortOrder
  ) {
    return null;
  }
  return selection;
}

/**
 * Parse URL search params into a selection.
 * Both omitted → null (server default). Order-only → null (shared URL always
 * pairs both when the user opts in). Invalid values → null (no silent remap).
 */
export function parseFilesSortSelection(
  sortBy: string | null | undefined,
  sortOrder: string | null | undefined,
): FilesSortSelection | null {
  if (
    (sortBy === null || sortBy === undefined) &&
    (sortOrder === null || sortOrder === undefined)
  ) {
    return null;
  }

  if (sortBy === null || sortBy === undefined || !isFilesSortBy(sortBy)) {
    return null;
  }

  if (sortOrder === null || sortOrder === undefined) {
    return { sortBy, sortOrder: defaultSortOrderForKey(sortBy) };
  }

  if (!isFilesSortOrder(sortOrder)) {
    return null;
  }

  return { sortBy, sortOrder };
}

/** Values for nuqs — null clears the param so defaults stay off the URL. */
export function filesSortUrlValues(selection: FilesSortSelection | null): {
  sortBy: FilesSortBy | null;
  sortOrder: FilesSortOrder | null;
} {
  if (!selection) {
    return { sortBy: null, sortOrder: null };
  }
  return { sortBy: selection.sortBy, sortOrder: selection.sortOrder };
}

/**
 * Map UI selection to Drive list query params.
 * Null selection → no override (omit). Recents name/type still send those
 * keys; Core treats them as secondary with activityAt primary.
 */
export function toDriveListSortQuery(
  selection: FilesSortSelection | null,
): DriveListSortQuery {
  if (!selection) {
    return {};
  }
  return {
    sortBy: selection.sortBy,
    sortOrder: selection.sortOrder,
  };
}
