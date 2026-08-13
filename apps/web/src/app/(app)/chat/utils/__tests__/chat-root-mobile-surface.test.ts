import { describe, expect, it } from "vitest";

import { resolveChatRootMobileSurface } from "../chat-root-mobile-surface";

describe("resolveChatRootMobileSurface", () => {
  it("returns landing when there are no membership-visible or archived rooms", () => {
    expect(
      resolveChatRootMobileSurface({
        membershipVisibleCount: 0,
        archivedCount: 0,
      }),
    ).toBe("landing");
  });

  it("returns list when any membership-visible room exists", () => {
    expect(
      resolveChatRootMobileSurface({
        membershipVisibleCount: 1,
        archivedCount: 0,
      }),
    ).toBe("list");
  });

  it("returns list when only archived rooms exist", () => {
    expect(
      resolveChatRootMobileSurface({
        membershipVisibleCount: 0,
        archivedCount: 2,
      }),
    ).toBe("list");
  });
});
