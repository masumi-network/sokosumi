import { describe, expect, it } from "vitest";

import {
  buildMemberFilterOptions,
  buildMemberPreviewItems,
} from "../member-filter-options";

describe("buildMemberFilterOptions", () => {
  it("prepends a synthetic Me option and deduplicates the current user", () => {
    const result = buildMemberFilterOptions(
      [
        {
          userId: "user-1",
          user: {
            name: "Alice",
            email: "alice@example.com",
            image: "alice.png",
          },
        },
        {
          userId: "user-2",
          user: {
            name: "Bob",
            email: "bob@example.com",
            image: null,
          },
        },
      ] as never,
      "user-1",
      "Me",
      "me.png",
    );

    expect(result).toEqual([
      {
        id: "user-1",
        name: "Me",
        image: "me.png",
        isMe: true,
      },
      {
        id: "user-2",
        name: "Bob",
        image: null,
      },
    ]);
  });

  it("keeps the signed-in user preview even without organization members", () => {
    const result = buildMemberPreviewItems([], {
      id: "user-1",
      name: "Alice",
      email: "alice@example.com",
      image: "alice.png",
    });

    expect(result).toEqual([
      {
        id: "user-1",
        name: "Alice",
        image: "alice.png",
      },
    ]);
  });
});
