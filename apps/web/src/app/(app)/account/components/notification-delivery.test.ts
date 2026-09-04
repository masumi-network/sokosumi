import { describe, expect, it } from "vitest";

import {
  categoryChannels,
  cellsFor,
  groupScope,
  groupScopes,
  type KindSpec,
  sameChannels,
  scopeChanges,
  withChannel,
} from "./notification-delivery";

const ATTENTION: KindSpec = {
  category: "JOB_ATTENTION",
  labelKey: "kindJobAttention",
  hintKey: "kindJobAttentionHint",
  important: true,
  email: true,
};

const UPDATE: KindSpec = {
  category: "JOB_UPDATE",
  labelKey: "kindJobUpdate",
  hintKey: "kindJobUpdateHint",
  important: false,
  email: true,
};

const MENTION: KindSpec = {
  category: "CHAT_MENTION",
  labelKey: "kindChatMention",
  hintKey: "kindChatMentionHint",
  important: true,
  email: false,
};

function cells(...rows: [string, string, boolean][]) {
  return rows.map(([category, channel, enabled]) => ({
    category,
    channel,
    enabled,
  })) as Parameters<typeof groupScope>[0];
}

describe("categoryChannels", () => {
  /**
   * A push with nothing waiting in Sokosumi is a combination the matrix can
   * hold, so the row reports it rather than rounding it to a louder answer.
   */
  it("names the channels a kind is on", () => {
    expect(
      categoryChannels(
        cells(
          ["JOB_ATTENTION", "IN_APP", false],
          ["JOB_ATTENTION", "OS_BANNER", true],
        ),
        "JOB_ATTENTION",
      ),
    ).toEqual(["OS_BANNER"]);
  });

  it("reads a kind with no channels as silent", () => {
    expect(
      categoryChannels(
        cells(
          ["JOB_UPDATE", "IN_APP", false],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        "JOB_UPDATE",
      ),
    ).toEqual([]);
  });
});

describe("withChannel", () => {
  it("adds one channel in the order the page draws them", () => {
    expect(withChannel(["OS_BANNER"], "IN_APP", true)).toEqual([
      "IN_APP",
      "OS_BANNER",
    ]);
  });

  it("drops the push and keeps the entry", () => {
    expect(withChannel(["IN_APP", "OS_BANNER"], "OS_BANNER", false)).toEqual([
      "IN_APP",
    ]);
  });

  it("leaves nothing when the last one goes", () => {
    expect(withChannel(["IN_APP"], "IN_APP", false)).toEqual([]);
  });

  /**
   * A push the reader cannot find again once the banner is gone is the one
   * pairing the row does not offer: the feed and the unread count both read
   * the in-app cell.
   */
  it("turns the entry on with the push", () => {
    expect(withChannel([], "OS_BANNER", true)).toEqual(["IN_APP", "OS_BANNER"]);
  });

  it("takes the push with the entry", () => {
    expect(withChannel(["IN_APP", "OS_BANNER"], "IN_APP", false)).toEqual([]);
  });
});
describe("cellsFor", () => {
  it("writes each category on its own channels", () => {
    expect(
      cellsFor(
        cells(
          ["JOB_ATTENTION", "IN_APP", false],
          ["JOB_ATTENTION", "OS_BANNER", false],
          ["JOB_UPDATE", "IN_APP", true],
          ["JOB_UPDATE", "OS_BANNER", true],
        ),
        scopeChanges("IMPORTANT", [
          { spec: ATTENTION, channels: [] },
          { spec: UPDATE, channels: ["IN_APP", "OS_BANNER"] },
        ]),
      ),
    ).toEqual([
      { category: "JOB_ATTENTION", channel: "IN_APP", enabled: true },
      { category: "JOB_ATTENTION", channel: "OS_BANNER", enabled: true },
      { category: "JOB_UPDATE", channel: "IN_APP", enabled: false },
      { category: "JOB_UPDATE", channel: "OS_BANNER", enabled: false },
    ]);
  });

  it("leaves a category nobody named alone", () => {
    expect(
      cellsFor(
        cells(
          ["JOB_ATTENTION", "IN_APP", false],
          ["CHAT_MENTION", "IN_APP", true],
        ),
        [{ category: "JOB_ATTENTION", channels: ["IN_APP", "OS_BANNER"] }],
      ),
    ).toEqual([
      { category: "JOB_ATTENTION", channel: "IN_APP", enabled: true },
    ]);
  });
});

describe("sameChannels", () => {
  /**
   * The row reads this to tell its own write from someone else's, so an order
   * or a repeat must not read as a different set and take a live sentence down
   * that is still true.
   */
  it("ignores the order each side names them in", () => {
    expect(sameChannels(["OS_BANNER", "IN_APP"], ["IN_APP", "OS_BANNER"])).toBe(
      true,
    );
  });

  it("does not read a repeated entry as a second channel", () => {
    expect(sameChannels(["IN_APP", "IN_APP"], ["IN_APP", "OS_BANNER"])).toBe(
      false,
    );
  });

  it("separates a kind that lost a channel", () => {
    expect(sameChannels(["IN_APP", "OS_BANNER"], ["IN_APP"])).toBe(false);
    expect(sameChannels([], ["IN_APP"])).toBe(false);
  });
});

describe("groupScopes", () => {
  it("offers all three where they mean different things", () => {
    expect(groupScopes([ATTENTION, UPDATE])).toEqual([
      "ALL",
      "IMPORTANT",
      "NONE",
    ]);
  });

  /**
   * Important keeps every kind of a group whose kinds all matter, so it writes
   * what All writes. Two stops that do the same thing read as a broken
   * control.
   */
  it("drops Important where it keeps everything", () => {
    expect(groupScopes([ATTENTION, MENTION])).toEqual(["ALL", "NONE"]);
  });

  /** The other end: Important keeps nothing, so it writes what Nothing writes. */
  it("drops Important where it keeps nothing", () => {
    expect(groupScopes([UPDATE])).toEqual(["ALL", "NONE"]);
  });
});

describe("groupScope", () => {
  it("names the scope the kinds that are on match", () => {
    expect(
      groupScope(
        cells(
          ["JOB_ATTENTION", "IN_APP", true],
          ["JOB_ATTENTION", "OS_BANNER", false],
          ["JOB_UPDATE", "IN_APP", false],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        [ATTENTION, UPDATE],
      ),
    ).toBe("IMPORTANT");
  });

  /** Which kinds arrive, not where: two kinds on in two places are still All. */
  it("reads only whether a kind arrives at all", () => {
    expect(
      groupScope(
        cells(
          ["JOB_ATTENTION", "IN_APP", true],
          ["JOB_ATTENTION", "OS_BANNER", true],
          ["JOB_UPDATE", "IN_APP", true],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        [ATTENTION, UPDATE],
      ),
    ).toBe("ALL");
  });

  it("says Custom when the kinds that are on are neither all nor the ones that matter", () => {
    expect(
      groupScope(
        cells(
          ["JOB_ATTENTION", "IN_APP", false],
          ["JOB_ATTENTION", "OS_BANNER", false],
          ["JOB_UPDATE", "IN_APP", true],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        [ATTENTION, UPDATE],
      ),
    ).toBe("CUSTOM");
  });
});

describe("scopeChanges", () => {
  it("keeps the kinds it names and silences the rest", () => {
    expect(
      scopeChanges("IMPORTANT", [
        { spec: ATTENTION, channels: ["IN_APP"] },
        { spec: UPDATE, channels: ["IN_APP"] },
      ]),
    ).toEqual([
      { category: "JOB_ATTENTION", channels: ["IN_APP"] },
      { category: "JOB_UPDATE", channels: [] },
    ]);
  });

  /**
   * An answer says which kinds arrive, never where. So a kind it keeps comes
   * back on the channels it was already on, and a group the reader has quieted
   * to the app alone does not start buzzing because they asked for everything.
   */
  it("leaves each kept kind on its own channels", () => {
    expect(
      scopeChanges("ALL", [
        { spec: ATTENTION, channels: ["IN_APP"] },
        { spec: UPDATE, channels: ["IN_APP", "OS_BANNER"] },
      ]),
    ).toEqual([
      { category: "JOB_ATTENTION", channels: ["IN_APP"] },
      { category: "JOB_UPDATE", channels: ["IN_APP", "OS_BANNER"] },
    ]);
  });

  /** A kind that arrives nowhere has nothing to keep, so it takes the group's. */
  it("gives a silent kind the channels the group uses", () => {
    expect(
      scopeChanges("ALL", [
        { spec: ATTENTION, channels: [] },
        { spec: UPDATE, channels: ["IN_APP"] },
      ]),
    ).toEqual([
      { category: "JOB_ATTENTION", channels: ["IN_APP"] },
      { category: "JOB_UPDATE", channels: ["IN_APP"] },
    ]);
  });

  /** A group that is on nowhere has no channel to keep, so it comes back loud. */
  it("turns a silent group on everywhere", () => {
    expect(
      scopeChanges("ALL", [
        { spec: ATTENTION, channels: [] },
        { spec: UPDATE, channels: [] },
      ]),
    ).toEqual([
      { category: "JOB_ATTENTION", channels: ["IN_APP", "OS_BANNER"] },
      { category: "JOB_UPDATE", channels: ["IN_APP", "OS_BANNER"] },
    ]);
  });
});
