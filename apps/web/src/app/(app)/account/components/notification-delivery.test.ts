import { describe, expect, it } from "vitest";

import {
  categoryChannels,
  cellsFor,
  type GroupSpec,
  groupPreset,
  type KindSpec,
  NOTIFICATION_GROUPS,
  type NotificationCategory,
  type Preset,
  type PresetSpec,
  presetChanges,
  presetPushes,
  presetStops,
  sameChannels,
  withChannel,
} from "./notification-delivery";

const MENTION: KindSpec = {
  category: "CHAT_MENTION",
  labelKey: "kindChatMention",
  hintKey: "kindChatMentionHint",
  email: false,
};

/** The group as the page holds it: these pin the table the reader presses. */
function group(id: string): GroupSpec {
  const spec = NOTIFICATION_GROUPS.find((one) => one.id === id);

  if (!spec) {
    throw new Error(`No group ${id}`);
  }

  return spec;
}

function preset(groupId: string, id: Preset): PresetSpec {
  const spec = group(groupId).presets.find((one) => one.id === id);

  if (!spec) {
    throw new Error(`No ${id} in ${groupId}`);
  }

  return spec;
}

function categories(kinds: readonly KindSpec[]): NotificationCategory[] {
  return kinds.map((kind) => kind.category);
}

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
        [
          { category: "JOB_ATTENTION", channels: ["IN_APP"] },
          { category: "JOB_UPDATE", channels: [] },
        ],
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

describe("NOTIFICATION_GROUPS", () => {
  /**
   * A kind a preset does not name is left as the reader had it, which is the
   * safe half of the bargain. The other half is this: a kind that reaches no
   * preset would sit outside every word on the rail, and the group would say
   * Custom for a reader who never set anything by hand.
   */
  it("gives every situation a place for every kind of its group", () => {
    const missing = NOTIFICATION_GROUPS.flatMap((spec) =>
      spec.presets.flatMap((one) =>
        spec.kinds
          .filter((kind) => !one.reach[kind.category])
          .map((kind) => `${spec.id} ${one.id} ${kind.category}`),
      ),
    );

    expect(missing).toEqual([]);
  });

  /** The other direction: a name the group does not hold writes nothing. */
  it("names no kind its group does not hold", () => {
    const strays = NOTIFICATION_GROUPS.flatMap((spec) =>
      spec.presets.flatMap((one) =>
        Object.keys(one.reach)
          .filter(
            (category) =>
              !categories(spec.kinds).includes(
                category as NotificationCategory,
              ),
          )
          .map((category) => `${spec.id} ${one.id} ${category}`),
      ),
    );

    expect(strays).toEqual([]);
  });

  /**
   * A task is work of the same shape as a job, and a reader who has just
   * answered this question one row above should not have to read a different
   * set of words to answer it again.
   */
  it("offers the same situations for tasks as for jobs", () => {
    expect(group("TASK").presets.map((one) => one.id)).toEqual(
      group("JOB").presets.map((one) => one.id),
    );
  });

  /**
   * The traffic a reader turns down first is the traffic no press should put
   * on their phone: what a job reports on its way to an answer, and every
   * message in a room they happen to be in.
   */
  it("sends the traffic a reader turns down first to no device", () => {
    const pushed = NOTIFICATION_GROUPS.flatMap((spec) =>
      spec.presets.flatMap((one) =>
        (["JOB_UPDATE", "TASK_UPDATE", "CHAT_ROOM_MESSAGE"] as const)
          .filter((category) => one.reach[category] === "PUSH")
          .map((category) => `${spec.id} ${one.id} ${category}`),
      ),
    );

    expect(pushed).toEqual([]);
  });
});

describe("groupPreset", () => {
  it("names the situation every cell of the group matches", () => {
    expect(
      groupPreset(
        cells(
          ["JOB_ATTENTION", "IN_APP", true],
          ["JOB_ATTENTION", "OS_BANNER", true],
          ["JOB_COMPLETED", "IN_APP", true],
          ["JOB_COMPLETED", "OS_BANNER", true],
          ["JOB_UPDATE", "IN_APP", true],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        group("JOB").presets,
        group("JOB").kinds,
      ),
    ).toBe("MOST");
  });

  /** One cell apart, and the two situations are different words. */
  it("tells the situations apart by the cell that differs", () => {
    expect(
      groupPreset(
        cells(
          ["JOB_ATTENTION", "IN_APP", true],
          ["JOB_ATTENTION", "OS_BANNER", true],
          ["JOB_COMPLETED", "IN_APP", true],
          ["JOB_COMPLETED", "OS_BANNER", false],
          ["JOB_UPDATE", "IN_APP", true],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        group("JOB").presets,
        group("JOB").kinds,
      ),
    ).toBe("ESSENTIAL");
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
          ["CHAT_ROOM_MESSAGE", "IN_APP", true],
          ["CHAT_ROOM_MESSAGE", "OS_BANNER", true],
          ["CHAT_MENTION", "IN_APP", true],
          ["CHAT_MENTION", "OS_BANNER", true],
          ["CHAT_DIRECT_MESSAGE", "IN_APP", true],
          ["CHAT_DIRECT_MESSAGE", "OS_BANNER", true],
        ),
        group("CHAT").presets,
        group("CHAT").kinds,
      ),
    ).toBe("CUSTOM");
  });

  /** A push with no entry behind it is a situation none of them writes. */
  it("says Custom for a push the situations never write", () => {
    expect(
      groupPreset(
        cells(
          ["JOB_ATTENTION", "IN_APP", false],
          ["JOB_ATTENTION", "OS_BANNER", true],
          ["JOB_COMPLETED", "IN_APP", false],
          ["JOB_COMPLETED", "OS_BANNER", true],
          ["JOB_UPDATE", "IN_APP", false],
          ["JOB_UPDATE", "OS_BANNER", true],
        ),
        group("JOB").presets,
        group("JOB").kinds,
      ),
    ).toBe("CUSTOM");
  });

  /**
   * The other half of leaving an unnamed kind alone: a situation that says
   * nothing about a kind cannot claim to be the one the group is in, or the
   * rail would light a word that never wrote those cells.
   */
  it("says Custom for a situation that does not name every kind", () => {
    expect(
      groupPreset(
        cells(
          ["JOB_ATTENTION", "IN_APP", false],
          ["JOB_ATTENTION", "OS_BANNER", false],
          ["JOB_COMPLETED", "IN_APP", false],
          ["JOB_COMPLETED", "OS_BANNER", false],
          ["JOB_UPDATE", "IN_APP", false],
          ["JOB_UPDATE", "OS_BANNER", false],
        ),
        [{ id: "OFF", hintKey: "presetJobOffHint", reach: {} }],
        group("JOB").kinds,
      ),
    ).toBe("CUSTOM");
  });

  /**
   * Core answers with the kinds it knows. A group whose cells have not all
   * arrived is read on the ones that did, so a page against an older Core
   * still names a situation rather than calling every group Custom.
   */
  it("reads a group on the kinds that came back", () => {
    expect(
      groupPreset(
        cells(
          ["CHAT_MENTION", "IN_APP", true],
          ["CHAT_MENTION", "OS_BANNER", true],
          ["CHAT_DIRECT_MESSAGE", "IN_APP", true],
          ["CHAT_DIRECT_MESSAGE", "OS_BANNER", true],
        ),
        group("CHAT").presets,
        group("CHAT").kinds.filter(
          (kind) => kind.category !== "CHAT_ROOM_MESSAGE",
        ),
      ),
    ).toBe("MOST");
  });
});

describe("presetChanges", () => {
  /**
   * The whole group, every cell of it. The reader's own cells are not read:
   * that is what lets the rail name the situation the group is in.
   */
  it("writes the situation on every kind of the group", () => {
    expect(presetChanges(preset("JOB", "MOST"), group("JOB").kinds)).toEqual([
      { category: "JOB_ATTENTION", channels: ["IN_APP", "OS_BANNER"] },
      { category: "JOB_COMPLETED", channels: ["IN_APP", "OS_BANNER"] },
      { category: "JOB_UPDATE", channels: ["IN_APP"] },
    ]);
  });

  it("silences the group", () => {
    expect(presetChanges(preset("CHAT", "OFF"), group("CHAT").kinds)).toEqual([
      { category: "CHAT_ROOM_MESSAGE", channels: [] },
      { category: "CHAT_MENTION", channels: [] },
      { category: "CHAT_DIRECT_MESSAGE", channels: [] },
    ]);
  });

  /** A press says nothing about a kind its situation never named. */
  it("leaves a kind the situation does not name alone", () => {
    expect(
      presetChanges(preset("JOB", "OFF"), [...group("JOB").kinds, MENTION]).map(
        (change) => change.category,
      ),
    ).toEqual(["JOB_ATTENTION", "JOB_COMPLETED", "JOB_UPDATE"]);
  });
});

describe("presetPushes", () => {
  it("names the kinds a situation sends to the device", () => {
    expect(
      categories(presetPushes(preset("JOB", "MOST"), group("JOB").kinds)),
    ).toEqual(["JOB_ATTENTION", "JOB_COMPLETED"]);
  });

  /** Its own word says so, and a list of the whole group under it is noise. */
  it("names none where the situation pushes them all", () => {
    expect(
      presetPushes(
        preset("CHAT", "ESSENTIAL"),
        group("CHAT").kinds.filter(
          (kind) => kind.category !== "CHAT_ROOM_MESSAGE",
        ),
      ),
    ).toEqual([]);
  });

  it("names none where the situation pushes nothing", () => {
    expect(
      presetPushes(preset("TASK", "APP_ONLY"), group("TASK").kinds),
    ).toEqual([]);
  });
});

describe("presetStops", () => {
  it("names the kinds a situation stops", () => {
    expect(
      categories(presetStops(preset("CHAT", "ESSENTIAL"), group("CHAT").kinds)),
    ).toEqual(["CHAT_ROOM_MESSAGE"]);
  });

  it("names none where the situation keeps them all", () => {
    expect(presetStops(preset("JOB", "MOST"), group("JOB").kinds)).toEqual([]);
  });

  /** Off stops every kind, and the word Off already says that. */
  it("names none where the situation stops them all", () => {
    expect(presetStops(preset("JOB", "OFF"), group("JOB").kinds)).toEqual([]);
  });
});
