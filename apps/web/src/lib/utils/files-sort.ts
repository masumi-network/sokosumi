/**
 * Shared Files sort vocabulary and URL/query mapping (Browse, Tasks).
 *
 * Omit both params → each endpoint keeps its current default
 * (Browse: name asc; Tasks: date desc).
 * Drive Recents does not accept sort; order is fixed activityAt descending.
 */

export const FILES_SORT_BY_VALUES = ["name", "date", "type"] as const;
export const FILES_SORT_ORDER_VALUES = ["asc", "desc"] as const;

export type FilesSortBy = (typeof FILES_SORT_BY_VALUES)[number];
export type FilesSortOrder = (typeof FILES_SORT_ORDER_VALUES)[number];

/** Surfaces that accept sort; omit-default matches Core per endpoint. */
export type FilesSortSurface = "browse" | "tasks";

export interface FilesSortSelection {
  sortBy: FilesSortBy;
  sortOrder: FilesSortOrder;
}

export interface DriveListSortQuery {
  sortBy?: FilesSortBy;
  sortOrder?: FilesSortOrder;
}

/** Core omit defaults — must match resolveDriveListSort fallback keys. */
export const FILES_SORT_OMIT_DEFAULTS: Record<
  FilesSortSurface,
  FilesSortSelection
> = {
  browse: { sortBy: "name", sortOrder: "asc" },
  tasks: { sortBy: "date", sortOrder: "desc" },
};

function isFilesSortBy(value: string): value is FilesSortBy {
  return (FILES_SORT_BY_VALUES as readonly string[]).includes(value);
}

function isFilesSortOrder(value: string): value is FilesSortOrder {
  return (FILES_SORT_ORDER_VALUES as readonly string[]).includes(value);
}

export function defaultSortOrderForKey(sortBy: FilesSortBy): FilesSortOrder {
  return sortBy === "date" ? "desc" : "asc";
}

export function toggleSortOrder(order: FilesSortOrder): FilesSortOrder {
  return order === "asc" ? "desc" : "asc";
}

/** Visible control value when URL params are omitted (matches Core omit). */
export function effectiveFilesSortSelection(
  selection: FilesSortSelection | null,
  surface: FilesSortSurface,
): FilesSortSelection {
  return selection ?? FILES_SORT_OMIT_DEFAULTS[surface];
}

/**
 * Map a concrete selection to URL/storage.
 * Collapses only when it matches this surface's Core omit default.
 */
export function toStoredFilesSortSelection(
  selection: FilesSortSelection,
  surface: FilesSortSurface,
): FilesSortSelection | null {
  const omitDefault = FILES_SORT_OMIT_DEFAULTS[surface];
  if (
    selection.sortBy === omitDefault.sortBy &&
    selection.sortOrder === omitDefault.sortOrder
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
 * Map UI selection to Drive list query params (Browse, Tasks).
 * Null selection → no override (omit).
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
