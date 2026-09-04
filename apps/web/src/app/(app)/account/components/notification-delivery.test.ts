import { describe, expect, it } from "vitest";

import {
  categoryChannels,
  cellsFor,
  groupPreset,
  groupPresets,
  type KindSpec,
  presetChanges,
  presetChannels,
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

describe("presetChannels", () => {
  it("puts everything on every channel", () => {
    expect(presetChannels("EVERYTHING", UPDATE)).toEqual([
      "IN_APP",
      "OS_BANNER",
    ]);
  });

  it("keeps what waits on the reader and drops the rest", () => {
    expect(presetChannels("IMPORTANT", ATTENTION)).toEqual([
      "IN_APP",
      "OS_BANNER",
    ]);
    expect(presetChannels("IMPORTANT", UPDATE)).toEqual([]);
  });

  it("keeps the same kinds in the app alone", () => {
    expect(presetChannels("QUIET", ATTENTION)).toEqual(["IN_APP"]);
    expect(presetChannels("QUIET", UPDATE)).toEqual([]);
  });

  it("silences everything", () => {
    expect(presetChannels("OFF", ATTENTION)).toEqual([]);
  });
});

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

describe("groupPresets", () => {
  it("offers all four where they mean different things", () => {
    expect(groupPresets([ATTENTION, UPDATE])).toEqual([
      "EVERYTHING",
      "IMPORTANT",
      "QUIET",
      "OFF",
    ]);
  });

  /**
   * Everything and Important write the same cells for a group whose kinds all
   * wait on the reader. Two stops that do the same thing read as a broken
   * control, so the later one is dropped.
   */
  it("drops a preset that writes what an earlier one writes", () => {
    expect(groupPresets([ATTENTION, MENTION])).toEqual([
      "EVERYTHING",
      "QUIET",
      "OFF",
    ]);
  });

  it("leaves a single kind its three answers", () => {
    expect(groupPresets([ATTENTION])).toEqual(["EVERYTHING", "QUIET", "OFF"]);
  });

  /**
   * Important and Quiet both silence a group whose kinds none of them wait on
   * the reader. Off is what a reader calls a stop that silences a group, so
   * that is the one that survives.
   */
  it("keeps the preset whose name describes what it writes", () => {
    expect(groupPresets([UPDATE])).toEqual(["EVERYTHING", "OFF"]);
  });
});

describe("groupPreset", () => {
  it("names the preset the stored cells match", () => {
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
    ).toBe("QUIET");
  });

  it("says Custom when the reader set the kinds one by one", () => {
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
    ).toBe("CUSTOM");
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
        presetChanges("IMPORTANT", [ATTENTION, UPDATE]),
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
