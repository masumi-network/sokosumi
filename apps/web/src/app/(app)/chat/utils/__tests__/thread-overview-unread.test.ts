import { describe, expect, it } from "vitest";
import {
  threadNeedsOverviewUnread,
  threadOverviewUnreadReplyCount,
} from "../thread-overview-unread";

describe("threadNeedsOverviewUnread", () => {
  it("is true when unreadReplyCount > 0 (including never-looked Participants)", () => {
    expect(
      threadNeedsOverviewUnread({
        unreadReplyCount: 37,
      }),
    ).toBe(true);
    expect(
      threadNeedsOverviewUnread({
        unreadReplyCount: 2,
      }),
    ).toBe(true);
  });

  it("is false when unreadReplyCount is 0 (lurkers, including Looked lurkers)", () => {
    expect(
      threadNeedsOverviewUnread({
        unreadReplyCount: 0,
      }),
    ).toBe(false);
  });
});

describe("threadOverviewUnreadReplyCount", () => {
  it("returns unreadReplyCount", () => {
    expect(
      threadOverviewUnreadReplyCount({
        unreadReplyCount: 37,
      }),
    ).toBe(37);
    expect(
      threadOverviewUnreadReplyCount({
        unreadReplyCount: 0,
      }),
    ).toBe(0);
  });
});
