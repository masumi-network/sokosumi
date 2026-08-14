import { describe, expect, it } from "vitest";
import {
  threadNeedsOverviewAttention,
  threadOverviewAttentionReplyCount,
} from "../thread-overview-attention";

describe("threadNeedsOverviewAttention", () => {
  it("is true when attentionReplyCount > 0 (qualifying never-looked)", () => {
    expect(
      threadNeedsOverviewAttention({
        attentionReplyCount: 37,
      }),
    ).toBe(true);
  });

  it("is true for looked threads with dual-baseline replies after look", () => {
    expect(
      threadNeedsOverviewAttention({
        attentionReplyCount: 2,
      }),
    ).toBe(true);
  });

  it("is false when attentionReplyCount is 0 (including non-qualifying never-looked)", () => {
    expect(
      threadNeedsOverviewAttention({
        attentionReplyCount: 0,
      }),
    ).toBe(false);
  });
});

describe("threadOverviewAttentionReplyCount", () => {
  it("returns the server qualifying count only", () => {
    expect(
      threadOverviewAttentionReplyCount({
        attentionReplyCount: 37,
      }),
    ).toBe(37);
    expect(
      threadOverviewAttentionReplyCount({
        attentionReplyCount: 0,
      }),
    ).toBe(0);
  });
});
