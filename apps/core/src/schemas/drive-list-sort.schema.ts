import { z } from "@hono/zod-openapi";

/**
 * Shared Files list sort vocabulary (Browse, Recents, Tasks).
 *
 * Omit both params to keep each endpoint's existing default order.
 * Invalid values are rejected by Zod (422) — no silent fallback.
 *
 * Recents: `activityAt` is always the primary key. `sortBy=name` / `type`
 * map to a secondary key only; `sortBy=date` (or omit with only `sortOrder`)
 * controls ascending vs descending on `activityAt`.
 *
 * Type families for file rows (stable clustering):
 * `image` | `video` | `audio` | `pdf` | `document` | `spreadsheet` |
 * `presentation` | `archive` | `code` | `text` | `other`
 * (derived from mime type and/or file extension; see `driveFileTypeFamily`).
 */
export const driveListSortBySchema = z
  .enum(["name", "date", "type"])
  .optional()
  .openapi({
    param: { name: "sortBy", in: "query" },
    description: [
      "Sort key: name | date | type.",
      "Omit with sortOrder to keep the endpoint default order.",
      "Recents: name/type are secondary only; activityAt stays primary.",
      "Tasks project/task levels: type falls back to name.",
    ].join(" "),
    example: "name",
  });

export const driveListSortOrderSchema = z
  .enum(["asc", "desc"])
  .optional()
  .openapi({
    param: { name: "sortOrder", in: "query" },
    description: [
      "Sort direction: asc | desc.",
      "When sortBy is omitted and sortOrder is set, applies to the endpoint's default key",
      "(Browse: name; Recents/Tasks: date).",
      "When sortBy is set without sortOrder: name/type → asc, date → desc.",
    ].join(" "),
    example: "asc",
  });

export const driveListSortQueryFields = {
  sortBy: driveListSortBySchema,
  sortOrder: driveListSortOrderSchema,
};

export type DriveListSortBy = "name" | "date" | "type";
export type DriveListSortOrder = "asc" | "desc";

export interface DriveListSort {
  sortBy: DriveListSortBy;
  sortOrder: DriveListSortOrder;
}

/**
 * Resolve optional query sort params.
 * Returns null when both are omitted (caller uses endpoint default).
 */
export function resolveDriveListSort(
  query: {
    sortBy?: DriveListSortBy;
    sortOrder?: DriveListSortOrder;
  },
  defaultKeyWhenOnlyOrder: DriveListSortBy,
): DriveListSort | null {
  if (query.sortBy === undefined && query.sortOrder === undefined) {
    return null;
  }

  const sortBy = query.sortBy ?? defaultKeyWhenOnlyOrder;
  const sortOrder = query.sortOrder ?? (sortBy === "date" ? "desc" : "asc");

  return { sortBy, sortOrder };
}
