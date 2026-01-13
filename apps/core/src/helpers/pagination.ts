import type { CursorPaginationMeta } from "@/schemas/pagination.schema";

/**
 * Result of parsing cursor pagination query parameters
 */
export interface CursorPaginationParams {
  cursor: string | undefined;
  limit: number;
  skip: number | undefined;
}

/**
 * Parses and validates cursor pagination query parameters
 * @param query - Query object containing cursor and limit
 * @returns Parsed pagination parameters with skip calculated
 */
export function parseCursorPagination(query: {
  cursor?: string;
  limit?: number;
}): CursorPaginationParams {
  const cursor = query.cursor;
  const limit = query.limit ?? 20;
  // Skip 1 if cursor exists (to skip the cursor record itself)
  const skip = cursor ? 1 : undefined;

  return {
    cursor,
    limit,
    skip,
  };
}

/**
 * Creates pagination metadata for cursor-based pagination
 * @param data - Array of data items (should include one extra item if hasNext)
 * @param limit - Requested limit (data may have limit + 1 items)
 * @param cursor - The cursor that was used for this request (optional)
 * @param cursorField - Field name to use for cursor extraction (default: "id")
 * @returns Pagination metadata object
 */
export function createCursorPaginationMeta<T extends Record<string, unknown>>(
  data: T[],
  limit: number,
  cursor: string | undefined,
  cursorField: keyof T = "id",
): CursorPaginationMeta {
  const hasNext = data.length > limit;
  const actualData = hasNext ? data.slice(0, limit) : data;
  const nextCursor =
    actualData.length > 0
      ? ((actualData[actualData.length - 1][cursorField] as string | null) ??
        null)
      : null;

  return {
    cursor: cursor ?? null,
    limit,
    hasNext,
    nextCursor,
  };
}
