import { LIMITS } from "@/config/constants";
import type { CursorPaginationMeta } from "@/schemas/pagination.schema";

export interface CursorPaginationParams {
  cursor: string | undefined;
  take: number;
  skip: number | undefined;
}

export function parseCursorPagination(query: {
  cursor?: string;
  limit?: number;
}): CursorPaginationParams {
  const cursor = query.cursor;
  const take = query.limit ?? LIMITS.DEFAULT_PAGINATION_LIMIT;

  const skip = cursor ? 1 : undefined;

  return {
    cursor,
    take,
    skip,
  };
}

export function createPaginationMeta<T extends { id: string }>(
  data: T[],
  count: number,
  take: number,
  hasMore: boolean,
  cursor: string | undefined,
  encodeNextCursor?: (item: T) => string,
): CursorPaginationMeta {
  const last = data.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeNextCursor
        ? encodeNextCursor(last)
        : last.id
      : null;

  return {
    cursor: cursor ?? null,
    limit: take,
    total: count,
    nextCursor,
  };
}
