import { describe, expect, it } from "vitest";

import { createPaginationMeta } from "./pagination";

describe("createPaginationMeta", () => {
  it("uses the supplied encoder for an opaque next cursor", () => {
    const meta = createPaginationMeta(
      [{ id: "occurrence-1", scheduledAt: "2026-09-10T10:00:00Z" }],
      2,
      1,
      true,
      undefined,
      (item) => `${item.scheduledAt}:${item.id}`,
    );

    expect(meta).toEqual({
      cursor: null,
      limit: 1,
      total: 2,
      nextCursor: "2026-09-10T10:00:00Z:occurrence-1",
    });
  });
});
