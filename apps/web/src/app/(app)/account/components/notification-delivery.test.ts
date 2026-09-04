import { describe, expect, it } from "vitest";

import {
  categoryChannels,
  cellsFor,
  groupPreset,
  groupPresets,
  type KindSpec,
  presetChanges,
  presetStops,
  sameChannels,
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
  })) as Parameters<typeof groupPreset>[0];
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
        presetChanges("NEEDED_QUIET", [ATTENTION, UPDATE]),
      ),
    ).toEqual([
      { category: "JOB_ATTENTION", channel: "IN_APP", enabled: true },
      { category: "JOB_ATTENTION", channel: "OS_BANNER", enabled: false },
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

describe("groupPresets", () => {
  it("offers every situation where the group holds both sorts of kind", () => {
    expect(groupPresets([ATTENTION, UPDATE])).toEqual([
      "ALL_PUSH",
      "NEEDED_PUSH",
      "NEEDED_PUSH_ONLY",
      "ALL_QUIET",
      "NEEDED_QUIET",
      "NOTHING",
    ]);
  });

  /**
   * "Only what matters" is every kind of a group where everything matters, so
   * it writes what its neighbour writes and says something about the group
   * that is not true of it.
   */
  it("speaks about all of a group where every kind matters", () => {
    expect(groupPresets([ATTENTION, MENTION])).toEqual([
      "ALL_PUSH",
      "ALL_QUIET",
      "NOTHING",
    ]);
  });

  /** The other end: nothing in the group is one of the ones that matter. */
  it("speaks about all of a group where no kind matters", () => {
    expect(groupPresets([UPDATE])).toEqual([
      "ALL_PUSH",
      "ALL_QUIET",
      "NOTHING",
    ]);
  });
});

describe("groupPreset", () => {
  it("names the situation every cell of the group matches", () => {
    expect(
      groupPreset(
        cells(
          ["JOB_ATTENTION", "IN_APP", true],
          ["JOB_ATTENTION", "OS_BANNER", true],
          ["JOB_UPDATE", "IN_APP", true],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        [ATTENTION, UPDATE],
      ),
    ).toBe("NEEDED_PUSH");
  });

  it("tells the quiet situations apart by what they stop", () => {
    expect(
      groupPreset(
        cells(
          ["JOB_ATTENTION", "IN_APP", true],
          ["JOB_ATTENTION", "OS_BANNER", false],
          ["JOB_UPDATE", "IN_APP", false],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        [ATTENTION, UPDATE],
      ),
    ).toBe("NEEDED_QUIET");
  });

  /**
   * Every cell has to match. A kind that arrives in one more place than the
   * situation says is a group doing something the word does not cover, and the
   * reader would read the word rather than the rows and believe it.
   */
  it("says Custom when one cell is off the situation", () => {
    expect(
      groupPreset(
        cells(
          ["JOB_ATTENTION", "IN_APP", true],
          ["JOB_ATTENTION", "OS_BANNER", true],
          ["JOB_UPDATE", "IN_APP", true],
          ["JOB_UPDATE", "OS_BANNER", true],
          ["CHAT_MENTION", "IN_APP", true],
          ["CHAT_MENTION", "OS_BANNER", false],
        ),
        [ATTENTION, UPDATE, MENTION],
      ),
    ).toBe("CUSTOM");
  });

  /** A push with no entry behind it is a situation none of them writes. */
  it("says Custom for a push the presets never write", () => {
    expect(
      groupPreset(
        cells(
          ["JOB_ATTENTION", "IN_APP", false],
          ["JOB_ATTENTION", "OS_BANNER", true],
          ["JOB_UPDATE", "IN_APP", false],
          ["JOB_UPDATE", "OS_BANNER", true],
        ),
        [ATTENTION, UPDATE],
      ),
    ).toBe("CUSTOM");
  });
});

describe("presetChanges", () => {
  /**
   * The whole group, every cell of it. The reader's own cells are not read:
   * that is what lets the button name the situation the group is in.
   */
  it("writes the loud situation on every kind", () => {
    expect(presetChanges("ALL_PUSH", [ATTENTION, UPDATE])).toEqual([
      { category: "JOB_ATTENTION", channels: ["IN_APP", "OS_BANNER"] },
      { category: "JOB_UPDATE", channels: ["IN_APP", "OS_BANNER"] },
    ]);
  });

  it("pushes the ones that matter and keeps the rest in Sokosumi", () => {
    expect(presetChanges("NEEDED_PUSH", [ATTENTION, UPDATE])).toEqual([
      { category: "JOB_ATTENTION", channels: ["IN_APP", "OS_BANNER"] },
      { category: "JOB_UPDATE", channels: ["IN_APP"] },
    ]);
  });

  it("stops the rest where the situation says only what matters", () => {
    expect(presetChanges("NEEDED_PUSH_ONLY", [ATTENTION, UPDATE])).toEqual([
      { category: "JOB_ATTENTION", channels: ["IN_APP", "OS_BANNER"] },
      { category: "JOB_UPDATE", channels: [] },
    ]);
  });

  it("silences the group", () => {
    expect(presetChanges("NOTHING", [ATTENTION, UPDATE])).toEqual([
      { category: "JOB_ATTENTION", channels: [] },
      { category: "JOB_UPDATE", channels: [] },
    ]);
  });
});

describe("presetStops", () => {
  it("names the kinds a situation stops", () => {
    expect(presetStops("NEEDED_QUIET", [ATTENTION, UPDATE])).toEqual([UPDATE]);
  });

  it("names none where the situation keeps them all", () => {
    expect(presetStops("ALL_QUIET", [ATTENTION, UPDATE])).toEqual([]);
  });

  /** Nothing stops every kind, and the word Nothing already says that. */
  it("names none where the situation stops them all", () => {
    expect(presetStops("NOTHING", [ATTENTION, UPDATE])).toEqual([]);
  });
});
