import { describe, expect, it } from "vitest";
import {
  threadNeedsOverviewAttention,
  threadOverviewAttentionReplyCount,
} from "../thread-overview-attention";

describe("threadNeedsOverviewAttention", () => {
  it("is true when unreadReplyCount > 0 (including never-looked Participants)", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 37,
      }),
    ).toBe(true);
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 2,
      }),
    ).toBe(true);
  });

  it("is false when unreadReplyCount is 0 (lurkers, including Looked lurkers)", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 0,
      }),
    ).toBe(false);
  });
});

describe("threadOverviewAttentionReplyCount", () => {
  it("returns unreadReplyCount", () => {
    expect(
      threadOverviewAttentionReplyCount({
        unreadReplyCount: 37,
      }),
    ).toBe(37);
    expect(
      threadOverviewAttentionReplyCount({
        unreadReplyCount: 0,
      }),
    ).toBe(0);
  });
});
