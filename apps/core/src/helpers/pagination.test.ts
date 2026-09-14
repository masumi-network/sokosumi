import { describe, expect, it } from "vitest";

import { createPaginationMeta } from "./pagination";

describe("createPaginationMeta", () => {
  it("uses the last id for the standard cursor", () => {
    expect(
      createPaginationMeta(
        [{ id: "first" }, { id: "second" }],
        3,
        2,
        true,
        undefined,
      ),
    ).toEqual({
      cursor: null,
      limit: 2,
      total: 3,
      nextCursor: "second",
    });
  });

  it("supports an opaque cursor encoder", () => {
    expect(
      createPaginationMeta(
        [{ id: "second", revision: 4 }],
        2,
        1,
        true,
        "current",
        (item) => `${item.revision}:${item.id}`,
      ),
    ).toEqual({
      cursor: "current",
      limit: 1,
      total: 2,
      nextCursor: "4:second",
    });
  });
});
