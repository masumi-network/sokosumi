import { describe, expect, it } from "vitest";

import {
  cellsFor,
  groupPreset,
  groupPresets,
  type KindSpec,
  presetChanges,
  presetDelivery,
} from "./notification-delivery";

const ATTENTION: KindSpec = {
  category: "JOB_ATTENTION",
  labelKey: "kindJobAttention",
  hintKey: "kindJobAttentionHint",
  important: true,
};

const UPDATE: KindSpec = {
  category: "JOB_UPDATE",
  labelKey: "kindJobUpdate",
  hintKey: "kindJobUpdateHint",
  important: false,
};

const MENTION: KindSpec = {
  category: "CHAT_MENTION",
  labelKey: "kindChatMention",
  hintKey: "kindChatMentionHint",
  important: true,
};

function cells(...rows: [string, string, boolean][]) {
  return rows.map(([category, channel, enabled]) => ({
    category,
    channel,
    enabled,
  })) as Parameters<typeof groupPreset>[0];
}

describe("presetDelivery", () => {
  it("gives everything a banner", () => {
    expect(presetDelivery("EVERYTHING", UPDATE)).toBe("BANNER");
  });

  it("keeps what waits on the reader and drops the rest", () => {
    expect(presetDelivery("IMPORTANT", ATTENTION)).toBe("BANNER");
    expect(presetDelivery("IMPORTANT", UPDATE)).toBe("OFF");
  });

  it("keeps the same kinds quietly", () => {
    expect(presetDelivery("QUIET", ATTENTION)).toBe("IN_APP");
    expect(presetDelivery("QUIET", UPDATE)).toBe("OFF");
  });

  it("silences everything", () => {
    expect(presetDelivery("OFF", ATTENTION)).toBe("OFF");
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

  it("leaves a single kind with the delivery ladder", () => {
    expect(groupPresets([ATTENTION])).toEqual(["EVERYTHING", "QUIET", "OFF"]);
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
  it("writes each category at its own loudness", () => {
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
        [{ category: "JOB_ATTENTION", delivery: "BANNER" }],
      ),
    ).toEqual([
      { category: "JOB_ATTENTION", channel: "IN_APP", enabled: true },
    ]);
  });
});
