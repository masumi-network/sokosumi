import { LIMITS } from "@/config/constants";

/**
 * Result of parsing cursor pagination query parameters
 */
export interface CursorPaginationParams {
  cursor: string | undefined;
  take: number;
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
  const take = query.limit ?? LIMITS.DEFAULT_PAGINATION_LIMIT;
  // Skip 1 if cursor exists (to skip the cursor record itself)
  const skip = cursor ? 1 : undefined;

  return {
    cursor,
    take,
    skip,
  };
}
