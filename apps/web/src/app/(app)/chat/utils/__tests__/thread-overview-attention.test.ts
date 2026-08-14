import { describe, expect, it } from "vitest";
import {
  threadNeedsOverviewAttention,
  threadOverviewAttentionReplyCount,
} from "../thread-overview-attention";

describe("threadNeedsOverviewAttention", () => {
  it("is true when attentionReplyCount > 0 (never-looked dual-baseline)", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 0,
        hasLooked: false,
        attentionReplyCount: 37,
      }),
    ).toBe(true);
  });

  it("is true for looked threads with ADR-0005 unread replies", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 2,
        hasLooked: true,
        attentionReplyCount: 2,
      }),
    ).toBe(true);
  });

  it("is false when dual-baseline and ADR-0005 are both clear", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 0,
        hasLooked: true,
        attentionReplyCount: 0,
      }),
    ).toBe(false);
  });

  it("falls back to never-looked when attentionReplyCount is omitted", () => {
    expect(
      threadNeedsOverviewAttention({
        unreadReplyCount: 0,
        hasLooked: false,
      }),
    ).toBe(true);
  });
});

describe("threadOverviewAttentionReplyCount", () => {
  it("prefers attentionReplyCount when present", () => {
    expect(
      threadOverviewAttentionReplyCount({
        unreadReplyCount: 1,
        replyCount: 10,
        attentionReplyCount: 37,
      }),
    ).toBe(37);
  });

  it("falls back to unreadReplyCount then replyCount", () => {
    expect(
      threadOverviewAttentionReplyCount({
        unreadReplyCount: 3,
        replyCount: 10,
      }),
    ).toBe(3);
    expect(
      threadOverviewAttentionReplyCount({
        unreadReplyCount: 0,
        replyCount: 10,
      }),
    ).toBe(10);
  });
});
