import { NOTIFICATION_EMAIL_CATEGORIES } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

// The generated index re-exports types only, and this needs the category list
// at runtime. Deep into the generated output on purpose: it is still what Core
// emitted, and a list retyped here would pass while Core and this page
// disagreed.
import { NotificationPreferenceSchema } from "@/lib/clients/generated/core/schemas.gen";

import {
  categoryChannels,
  cellsFor,
  type GroupSpec,
  groupPreset,
  type KindChannels,
  type KindSpec,
  NOTIFICATION_GROUPS,
  type NotificationCategory,
  type Preset,
  type PresetSpec,
  presetChanges,
  presetPushes,
  presetStops,
  type StoredChannel,
  sameChannels,
  withChannel,
} from "./notification-delivery";

const MENTION: KindSpec = {
  category: "CHAT_MENTION",
  labelKey: "kindChatMention",
  hintKey: "kindChatMentionHint",
  email: "CHANNEL",
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

/** The kinds as the page hands them to a preset: each on the channels given. */
function rows(
  kinds: readonly KindSpec[],
  channels: readonly StoredChannel[] = [],
): KindChannels[] {
  return kinds.map((spec) => ({ spec, channels }));
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
          ["TASK_ATTENTION", "IN_APP", false],
          ["TASK_ATTENTION", "OS_BANNER", true],
        ),
        "TASK_ATTENTION",
      ),
    ).toEqual(["OS_BANNER"]);
  });

  it("reads a kind with no channels as silent", () => {
    expect(
      categoryChannels(
        cells(
          ["TASK_UPDATE", "IN_APP", false],
          ["TASK_UPDATE", "OS_BANNER", false],
        ),
        "TASK_UPDATE",
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
          ["TASK_ATTENTION", "IN_APP", false],
          ["TASK_ATTENTION", "OS_BANNER", false],
          ["TASK_UPDATE", "IN_APP", true],
          ["TASK_UPDATE", "OS_BANNER", true],
        ),
        [
          { category: "TASK_ATTENTION", channels: ["IN_APP"] },
          { category: "TASK_UPDATE", channels: [] },
        ],
      ),
    ).toEqual([
      { category: "TASK_ATTENTION", channel: "IN_APP", enabled: true },
      { category: "TASK_ATTENTION", channel: "OS_BANNER", enabled: false },
      { category: "TASK_UPDATE", channel: "IN_APP", enabled: false },
      { category: "TASK_UPDATE", channel: "OS_BANNER", enabled: false },
    ]);
  });

  it("leaves a category nobody named alone", () => {
    expect(
      cellsFor(
        cells(
          ["TASK_ATTENTION", "IN_APP", false],
          ["CHAT_MENTION", "IN_APP", true],
        ),
        [{ category: "TASK_ATTENTION", channels: ["IN_APP", "OS_BANNER"] }],
      ),
    ).toEqual([
      { category: "TASK_ATTENTION", channel: "IN_APP", enabled: true },
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
  /**
   * A category Core knows and this page does not draw is a switch the reader
   * cannot reach: their notifications arrive on the defaults forever, and the
   * page says nothing about them. Read from the generated client rather than
   * listed here, so adding a category to Core is what fails this, in the one
   * place that has to answer for it.
   */
  it("draws a row for every category Core knows", () => {
    const drawn = NOTIFICATION_GROUPS.flatMap((spec) => categories(spec.kinds));
    const known = NotificationPreferenceSchema.properties.category
      .enum as readonly string[];

    expect([...known].sort()).toEqual([...drawn].sort());
  });

  /** A category drawn twice is two switches writing over one another. */
  it("draws each category once", () => {
    const drawn = NOTIFICATION_GROUPS.flatMap((spec) => categories(spec.kinds));

    expect(drawn).toEqual([...new Set(drawn)]);
  });

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
   * The answer reads the same across the card: every group that offers
   * situations offers the same four, in the same order. A reader who has just
   * answered this question one row above should not have to read a different
   * set of words to answer it again.
   */
  it("offers every group the same situations, in the same order", () => {
    const offered = NOTIFICATION_GROUPS.filter(
      (one) => one.presets.length > 0,
    ).map((one) => one.presets.map((preset) => preset.id));

    // Two groups at least, or the loop below compares nothing.
    expect(offered.length).toBeGreaterThan(1);
    for (const ids of offered) {
      expect(ids).toEqual(["MOST", "ESSENTIAL", "APP_ONLY", "OFF"]);
    }
  });

  /**
   * The traffic a reader turns down first is the traffic no press should put
   * on their phone: what a task reports on its way to an answer, and every
   * message in a room they happen to be in.
   */
  it("sends the traffic a reader turns down first to no device", () => {
    const pushed = NOTIFICATION_GROUPS.flatMap((spec) =>
      spec.presets.flatMap((one) =>
        (["TASK_UPDATE", "CHAT_ROOM_MESSAGE"] as const)
          .filter((category) => one.reach[category] === "PUSH")
          .map((category) => `${spec.id} ${one.id} ${category}`),
      ),
    );

    expect(pushed).toEqual([]);
  });

  /**
   * The one billing notice worth interrupting for is also the one a reader
   * must not lose: a wallet that runs out stops their work. So every stop but
   * Off keeps it in the app, and the two loud stops put it on the device.
   */
  it("keeps billing that waits on the reader at every stop but Off", () => {
    const reach = group("BILLING").presets.map(
      (one) => `${one.id} ${one.reach.BILLING_ATTENTION}`,
    );

    expect(reach).toEqual([
      "MOST PUSH",
      "ESSENTIAL PUSH",
      "APP_ONLY IN_APP",
      "OFF NONE",
    ]);
  });
});

describe("groupPreset", () => {
  it("names the situation every cell of the group matches", () => {
    expect(
      groupPreset(
        cells(
          ["TASK_ATTENTION", "IN_APP", true],
          ["TASK_ATTENTION", "OS_BANNER", true],
          ["TASK_COMPLETED", "IN_APP", true],
          ["TASK_COMPLETED", "OS_BANNER", true],
          ["TASK_UPDATE", "IN_APP", true],
          ["TASK_UPDATE", "OS_BANNER", false],
        ),
        group("TASK").presets,
        group("TASK").kinds,
      ),
    ).toBe("MOST");
  });

  /**
   * No situation writes the email cells, so none of them is read here. A
   * reader who turned one row's email off is still exactly on Most, and the
   * rail says so rather than Custom.
   */
  it("reads the group by the cells a situation speaks for", () => {
    expect(
      groupPreset(
        cells(
          ["TASK_ATTENTION", "IN_APP", true],
          ["TASK_ATTENTION", "OS_BANNER", true],
          ["TASK_ATTENTION", "EMAIL", false],
          ["TASK_COMPLETED", "IN_APP", true],
          ["TASK_COMPLETED", "OS_BANNER", true],
          ["TASK_COMPLETED", "EMAIL", true],
          ["TASK_UPDATE", "IN_APP", true],
          ["TASK_UPDATE", "OS_BANNER", false],
        ),
        group("TASK").presets,
        group("TASK").kinds,
      ),
    ).toBe("MOST");
  });

  /** One cell apart, and the two situations are different words. */
  it("tells the situations apart by the cell that differs", () => {
    expect(
      groupPreset(
        cells(
          ["TASK_ATTENTION", "IN_APP", true],
          ["TASK_ATTENTION", "OS_BANNER", true],
          ["TASK_COMPLETED", "IN_APP", true],
          ["TASK_COMPLETED", "OS_BANNER", false],
          ["TASK_UPDATE", "IN_APP", true],
          ["TASK_UPDATE", "OS_BANNER", false],
        ),
        group("TASK").presets,
        group("TASK").kinds,
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
          ["TASK_ATTENTION", "IN_APP", false],
          ["TASK_ATTENTION", "OS_BANNER", true],
          ["TASK_COMPLETED", "IN_APP", false],
          ["TASK_COMPLETED", "OS_BANNER", true],
          ["TASK_UPDATE", "IN_APP", false],
          ["TASK_UPDATE", "OS_BANNER", true],
        ),
        group("TASK").presets,
        group("TASK").kinds,
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
          ["TASK_ATTENTION", "IN_APP", false],
          ["TASK_ATTENTION", "OS_BANNER", false],
          ["TASK_COMPLETED", "IN_APP", false],
          ["TASK_COMPLETED", "OS_BANNER", false],
          ["TASK_UPDATE", "IN_APP", false],
          ["TASK_UPDATE", "OS_BANNER", false],
        ),
        [{ id: "OFF", hintKey: "presetTaskOffHint", reach: {} }],
        group("TASK").kinds,
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
   * The whole group, every cell the situation speaks for. The channels each
   * kind is on now are not read for those: that is what lets the rail name
   * the situation the group is in.
   */
  it("writes the situation on every kind of the group", () => {
    expect(
      presetChanges(preset("TASK", "MOST"), rows(group("TASK").kinds)),
    ).toEqual([
      { category: "TASK_ATTENTION", channels: ["IN_APP", "OS_BANNER"] },
      { category: "TASK_COMPLETED", channels: ["IN_APP", "OS_BANNER"] },
      { category: "TASK_UPDATE", channels: ["IN_APP"] },
    ]);
  });

  it("silences the group", () => {
    expect(
      presetChanges(
        preset("CHAT", "OFF"),
        rows(group("CHAT").kinds, ["IN_APP", "OS_BANNER"]),
      ),
    ).toEqual([
      { category: "CHAT_ROOM_MESSAGE", channels: [] },
      { category: "CHAT_MENTION", channels: [] },
      { category: "CHAT_DIRECT_MESSAGE", channels: [] },
    ]);
  });

  /**
   * A situation is about Sokosumi and the device, and says nothing about the
   * inbox. So Off quiets a row and leaves its email as the reader set it,
   * rather than switching their emails off without saying so.
   */
  it("carries each kind's email cell over as it was", () => {
    const [attention, completed, update] = group("TASK").kinds;

    expect(
      presetChanges(preset("TASK", "OFF"), [
        { spec: attention, channels: ["IN_APP", "OS_BANNER", "EMAIL"] },
        { spec: completed, channels: ["IN_APP"] },
        { spec: update, channels: ["IN_APP"] },
      ]),
    ).toEqual([
      { category: "TASK_ATTENTION", channels: ["EMAIL"] },
      { category: "TASK_COMPLETED", channels: [] },
      { category: "TASK_UPDATE", channels: [] },
    ]);
  });

  /** A press says nothing about a kind its situation never named. */
  it("leaves a kind the situation does not name alone", () => {
    expect(
      presetChanges(
        preset("TASK", "OFF"),
        rows([...group("TASK").kinds, MENTION]),
      ).map((change) => change.category),
    ).toEqual(["TASK_ATTENTION", "TASK_COMPLETED", "TASK_UPDATE"]);
  });
});

describe("presetPushes", () => {
  it("names the kinds a situation sends to the device", () => {
    expect(
      categories(presetPushes(preset("TASK", "MOST"), group("TASK").kinds)),
    ).toEqual(["TASK_ATTENTION", "TASK_COMPLETED"]);
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
    expect(presetStops(preset("TASK", "MOST"), group("TASK").kinds)).toEqual(
      [],
    );
  });

  /** Off stops every kind, and the word Off already says that. */
  it("names none where the situation stops them all", () => {
    expect(presetStops(preset("TASK", "OFF"), group("TASK").kinds)).toEqual([]);
  });
});

describe("NOTIFICATION_GROUPS", () => {
  /**
   * The rows that draw an email cell are the categories Core mails, and Core
   * keeps that list (`NOTIFICATION_EMAIL_CATEGORIES`). This file is a test,
   * so it reads the list rather than pinning a copy: a row moved onto or off
   * it fails here in the same change, rather than drawing a cell Core
   * ignores or hiding one it reads (SOK-1090, SOK-916, SOK-1142). App code
   * still cannot take this import; the page keeps its own vocabulary. Both
   * sides are sorted, because the page orders its rows for the reader and
   * Core orders its list for itself.
   */
  it("offers the email cell on the rows Core mails", () => {
    expect(
      NOTIFICATION_GROUPS.flatMap((group) =>
        group.kinds
          .filter((kind) => kind.email === "CHANNEL")
          .map((kind) => kind.category),
      ).toSorted(),
    ).toEqual([...NOTIFICATION_EMAIL_CATEGORIES].toSorted());
  });

  /**
   * Every other row says where its email really comes from, or it is a
   * coming-soon cell again: a promise the row behind it does not keep.
   */
  it("marks every row it does not mail as arriving from elsewhere", () => {
    const mailed = new Set<string>(NOTIFICATION_EMAIL_CATEGORIES);

    expect(
      NOTIFICATION_GROUPS.flatMap((group) =>
        group.kinds
          .filter((kind) => !mailed.has(kind.category))
          .map((kind) => `${kind.category} ${kind.email}`),
      ),
    ).toEqual(["BILLING_UPDATE EXTERNAL"]);
  });
});
