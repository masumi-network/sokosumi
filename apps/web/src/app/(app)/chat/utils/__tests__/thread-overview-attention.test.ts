import { describe, expect, it } from "vitest";
import { threadNeedsOverviewAttention } from "../thread-overview-attention";

describe("threadNeedsOverviewAttention", () => {
  it("is true for looked threads with unread replies", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 2,
        hasLooked: true,
      }),
    ).toBe(true);
  });

  it("is true for never-looked threads even when unreadReplyCount is 0", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 0,
        hasLooked: false,
      }),
    ).toBe(true);
  });

  it("is false for looked threads with no unread replies", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 0,
        hasLooked: true,
      }),
    ).toBe(false);
  });
});
