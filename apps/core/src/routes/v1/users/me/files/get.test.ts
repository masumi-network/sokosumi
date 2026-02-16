import { describe, expect, it } from "vitest";

import { LIMITS } from "@/config/constants";
import {
  userFilesPaginatedResponseSchema,
  userFilesQuerySchema,
} from "@/schemas/user-file.schema";

describe("userFilesQuerySchema", () => {
  it("defaults limit to user files pagination default", () => {
    const parsed = userFilesQuerySchema.parse({});

    expect(parsed).toEqual({
      cursor: undefined,
      limit: LIMITS.USER_FILES_DEFAULT_PAGINATION_LIMIT,
    });
  });

  it("allows explicit cursor and limit", () => {
    const parsed = userFilesQuerySchema.parse({
      cursor: "cursor_abc",
      limit: "10",
    });

    expect(parsed).toEqual({
      cursor: "cursor_abc",
      limit: 10,
    });
  });

  it("rejects limit above max pagination limit", () => {
    expect(() =>
      userFilesQuerySchema.parse({
        limit: LIMITS.MAX_PAGINATION_LIMIT + 1,
      }),
    ).toThrow();
  });
});

describe("userFilesPaginatedResponseSchema", () => {
  it("accepts files pagination metadata without total", () => {
    const parsed = userFilesPaginatedResponseSchema.parse({
      data: [
        {
          publicUrl: "https://blob.example/users/user_123/a.txt",
          metadata: {
            pathname: "users/user_123/a.txt",
            downloadUrl: "https://blob.example/download/a.txt",
            size: 1,
            uploadedAt: "2026-02-16T12:00:00.000Z",
            etag: '"etag"',
          },
        },
      ],
      meta: {
        timestamp: "2026-02-16T12:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        pagination: {
          cursor: null,
          limit: 10,
          hasMore: true,
          nextCursor: "cursor_abc123",
        },
      },
    });

    expect(parsed.meta.pagination.hasMore).toBe(true);
  });

  it("rejects missing hasMore in files pagination metadata", () => {
    expect(() =>
      userFilesPaginatedResponseSchema.parse({
        data: [],
        meta: {
          timestamp: "2026-02-16T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 10,
            nextCursor: null,
          },
        },
      }),
    ).toThrow();
  });
});
