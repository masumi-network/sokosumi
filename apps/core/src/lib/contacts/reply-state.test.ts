import { describe, expect, it } from "vitest";
import { contactReplyState, replyStateWhere } from "./reply-state";

const NOW = new Date("2026-10-23T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("contactReplyState", () => {
  it("is awaiting a reply for a week, then no reply", () => {
    const fields = (days: number) => ({
      lastInboundAt: null,
      awaitingReplySince: daysAgo(days),
    });
    expect(contactReplyState(fields(6), NOW)).toBe("AWAITING_REPLY");
    expect(contactReplyState(fields(7), NOW)).toBe("NO_REPLY");
    expect(contactReplyState(fields(90), NOW)).toBe("NO_REPLY");
  });

  it("is in conversation while they wrote within 30 days, replied after", () => {
    const fields = (days: number) => ({
      lastInboundAt: daysAgo(days),
      awaitingReplySince: null,
    });
    expect(contactReplyState(fields(3), NOW)).toBe("IN_CONVERSATION");
    expect(contactReplyState(fields(31), NOW)).toBe("REPLIED");
  });

  it("is null without directed interactions", () => {
    expect(
      contactReplyState({ lastInboundAt: null, awaitingReplySince: null }, NOW),
    ).toBeNull();
  });
});

describe("replyStateWhere", () => {
  it("splits waiting contacts at the same week the state uses", () => {
    expect(replyStateWhere("NO_REPLY", NOW)).toEqual({
      awaitingReplySince: { lte: daysAgo(7) },
    });
    expect(replyStateWhere("AWAITING_REPLY", NOW)).toEqual({
      awaitingReplySince: { gt: daysAgo(7) },
    });
    expect(replyStateWhere("REPLIED", NOW)).toEqual({
      awaitingReplySince: null,
      lastInboundAt: { lt: daysAgo(30) },
    });
  });
});
