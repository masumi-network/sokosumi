import type {
  CmoCalendarEntry,
  MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import {
  CMO_CHANNELS,
  CMO_VOLUME_LEVELS,
  type CmoVolumeLevel,
  cmoMonthAtLevel,
  cmoMonthFloor,
  cmoMonthPieceBudget,
  cmoPieceCredits,
  isCmoShortVideoFormat,
  isCmoTalkingFormat,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import {
  CMO_TALKING_EVERY_LEAD_POST,
  CMO_TALKING_EVERY_SHORT,
  type CmoMonthSlot,
  cmoMonthChunks,
  cmoPlanMonthSlots,
  cmoQuota,
  cmoSlotNetworks,
  cmoSpread,
  cmoTalkingVideoCount,
} from "./cmo-month-slots";
import { mixProblems, pillarProblems } from "./cmo-plan-review.service";

const START = "2026-12-01";

const EVERY_NETWORK = [
  "x",
  "linkedin",
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
].map((channel) => ({ channel, cadence: "top rate" }));

type Plan = Pick<
  MarketingStrategyPlan,
  "channels" | "pillars" | "mix" | "calendar"
>;

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    channels: EVERY_NETWORK,
    pillars: [
      { name: "Launch planning", share: 40, why: "i1 i2 i3" },
      { name: "Token metadata", share: 30, why: "i4 i5 i6" },
      { name: "Fees and costs", share: 20, why: "i7 i8 i9" },
      { name: "Market news", share: 10, why: "i1 i4 i7" },
    ],
    mix: [
      { approach: "educational", share: 60, why: "Help with launches" },
      { approach: "product-led", share: 20, why: "Studio doing a job" },
      { approach: "social-proof", share: 10, why: "Projects that launched" },
      { approach: "promotional", share: 10, why: "The free account" },
    ],
    calendar: [],
    ...overrides,
  };
}

function example(id: string, overrides: Partial<CmoCalendarEntry>) {
  return {
    id,
    date: START,
    time: "10:00",
    channel: "linkedin",
    format: "image",
    status: "idea",
    title: `Example ${id}`,
    brief: "An example",
    approach: "educational",
    pillar: "Launch planning",
    stage: "awareness",
    ...overrides,
  } as CmoCalendarEntry;
}

const slotsAt = (level: CmoVolumeLevel, base: Plan = plan()) =>
  cmoPlanMonthSlots({ plan: base, level, start: START });

const asEntries = (slots: CmoMonthSlot[]): CmoCalendarEntry[] =>
  slots.map((slot) => ({ ...slot, status: "idea", title: slot.id }));

describe("cmoPlanMonthSlots", () => {
  it.each(CMO_VOLUME_LEVELS)(
    "plans at least the %s plan's floor on every network, LinkedIn one talking video a week on top, Facebook at its pace",
    (level) => {
      const slots = slotsAt(level);
      const floor = cmoMonthFloor(EVERY_NETWORK, level);
      for (const { network, posts } of floor.byNetwork) {
        const reach = slots.filter((slot) =>
          cmoSlotNetworks(slot).includes(network),
        ).length;
        expect(reach, network).toBeGreaterThanOrEqual(posts);
        if (network === "linkedin") expect(reach, network).toBe(posts + 4);
        if (network === "facebook") expect(reach, network).toBe(posts);
      }
    },
  );

  it.each(CMO_VOLUME_LEVELS)(
    "makes one short video in four a talking video at the %s plan, within its credits",
    (level) => {
      const slots = slotsAt(level);
      const talking = slots.filter((slot) =>
        isCmoTalkingFormat(slot.channel, slot.format),
      );
      const shortsPerMonth = { steady: 68, active: 112, all_in: 196 }[level];
      expect(talking).toHaveLength(
        Math.floor(shortsPerMonth / CMO_TALKING_EVERY_SHORT),
      );
      const credits = slots.reduce(
        (sum, slot) => sum + cmoPieceCredits(slot.channel, slot.format),
        0,
      );
      expect(credits).toBeLessThanOrEqual(cmoMonthPieceBudget(level));
    },
  );

  it.each(CMO_VOLUME_LEVELS)(
    "plans only posts production makes at the %s plan",
    (level) => {
      const entries = asEntries(slotsAt(level));
      const made = cmoMonthAtLevel(entries, level, START);
      expect(made.made.size).toBe(entries.length);
    },
  );

  it("holds every pillar's and approach's share on every network and in the month", () => {
    const entries = asEntries(slotsAt("all_in"));
    const base = plan();
    expect(pillarProblems(base.pillars, entries)).toEqual([]);
    expect(mixProblems(base.mix, entries)).toEqual([]);
    for (const network of new Set(entries.map((entry) => entry.channel))) {
      const own = entries.filter((entry) => entry.channel === network);
      if (own.length < 10) continue;
      expect(pillarProblems(base.pillars, own), network).toEqual([]);
      expect(mixProblems(base.mix, own), network).toEqual([]);
    }
  });

  it("spreads each pillar over the weeks, never in a block", () => {
    const x = slotsAt("steady").filter((slot) => slot.channel === "x");
    for (const week of [0, 1, 2, 3]) {
      const days = x.filter(
        (slot) =>
          Math.floor(
            (Date.parse(slot.date) - Date.parse(START)) / 86_400_000 / 7,
          ) === week,
      );
      expect(new Set(days.map((slot) => slot.pillar)).size).toBe(4);
    }
  });

  it("serves every funnel step, offers at action and proof at desire", () => {
    const slots = slotsAt("active");
    expect(new Set(slots.map((slot) => slot.stage))).toEqual(
      new Set(["awareness", "interest", "desire", "action"]),
    );
    expect(
      slots
        .filter((slot) => slot.approach === "promotional")
        .every((slot) => slot.stage === "action"),
    ).toBe(true);
    expect(
      slots
        .filter((slot) => slot.approach === "social-proof")
        .every((slot) => slot.stage === "desire"),
    ).toBe(true);
    for (const network of new Set(slots.map((slot) => slot.channel))) {
      const own = slots.filter((slot) => slot.channel === network);
      if (own.length >= 8)
        expect(new Set(own.map((slot) => slot.stage)).size).toBeGreaterThan(1);
    }
  });

  it("still asks for the offer when the mix has no promotional posts", () => {
    const slots = slotsAt(
      "steady",
      plan({ mix: [{ approach: "educational", share: 100, why: "Tips" }] }),
    );
    for (const stage of ["desire", "action"])
      expect(slots.some((slot) => slot.stage === stage)).toBe(true);
  });

  it("uses only formats the network has, with pictures on most posts", () => {
    const slots = slotsAt("all_in");
    const channels = CMO_CHANNELS as Record<
      string,
      { formats: Record<string, { image?: boolean; video?: boolean }> }
    >;
    for (const slot of slots)
      expect(
        channels[slot.channel]?.formats[slot.format],
        `${slot.channel}/${slot.format}`,
      ).toBeDefined();
    const carries = (slot: CmoMonthSlot) => {
      const format = channels[slot.channel]?.formats[slot.format];
      return Boolean(format?.image || format?.video);
    };
    const x = slots.filter((slot) => slot.channel === "x");
    expect(x.filter(carries).length / x.length).toBeGreaterThanOrEqual(0.4);
    for (const network of ["linkedin", "facebook", "instagram"]) {
      const own = slots.filter((slot) => slot.channel === network);
      const words = own.filter((slot) => !carries(slot)).length;
      expect(words / own.length, network).toBeLessThanOrEqual(0.25);
    }
  });

  it("shares each short video with the other short-video networks", () => {
    const shorts = slotsAt("steady").filter((slot) =>
      isCmoShortVideoFormat(slot.channel, slot.format),
    );
    const talking = slotsAt("steady").filter((slot) =>
      isCmoTalkingFormat(slot.channel, slot.format),
    );
    expect(shorts.length + talking.length).toBe(17 * 4);
    for (const short of shorts) {
      expect(short.alsoOn).toHaveLength(2);
      expect(short.alsoOn).not.toContain(short.channel);
    }
  });

  it("sends one talking video a week out on LinkedIn, every one on Facebook, the rest on the short-video networks", () => {
    const talking = slotsAt("all_in").filter((slot) =>
      isCmoTalkingFormat(slot.channel, slot.format),
    );
    const week = (slot: CmoMonthSlot) =>
      Math.floor((Date.parse(slot.date) - Date.parse(START)) / 86_400_000 / 7);
    const onLinkedIn = talking.filter((slot) =>
      slot.alsoOn?.includes("linkedin"),
    );
    expect(onLinkedIn.map(week).toSorted()).toEqual([0, 1, 2, 3]);
    for (const slot of talking)
      expect(new Set(cmoSlotNetworks(slot))).toEqual(
        new Set([
          ...(onLinkedIn.includes(slot) ? ["linkedin"] : []),
          "instagram",
          "facebook",
          "tiktok",
          "youtube",
        ]),
      );
  });

  it("gives up Facebook's link posts and Reels before its pictures for talking videos", () => {
    for (const level of CMO_VOLUME_LEVELS) {
      const before = cmoPlanMonthSlots({
        plan: plan({
          channels: EVERY_NETWORK.filter(
            (channel) =>
              !["tiktok", "youtube", "instagram", "linkedin"].includes(
                channel.channel,
              ),
          ),
        }),
        level,
        start: START,
      }).filter((slot) => slot.channel === "facebook");
      const after = slotsAt(level).filter(
        (slot) => slot.channel === "facebook",
      );
      const gone = (format: string) =>
        before.filter((slot) => slot.format === format).length -
        after.filter((slot) => slot.format === format).length;
      if (gone("image") > 0) {
        expect(
          after.filter((slot) => slot.format === "link"),
          level,
        ).toEqual([]);
        expect(
          after.filter((slot) => slot.format === "reel"),
          level,
        ).toEqual([]);
      }
    }
  });

  it("turns one LinkedIn post in three into a talking video when the month has no short videos", () => {
    const channels = ["x", "linkedin"].map((channel) => ({
      channel,
      cadence: "top rate",
    }));
    for (const level of CMO_VOLUME_LEVELS) {
      const slots = slotsAt(level, plan({ channels }));
      const linkedin = slots.filter((slot) => slot.channel === "linkedin");
      const talking = linkedin.filter((slot) =>
        isCmoTalkingFormat(slot.channel, slot.format),
      );
      expect(talking.length, level).toBe(
        Math.floor(linkedin.length / CMO_TALKING_EVERY_LEAD_POST),
      );
      for (const slot of talking) expect(slot.alsoOn).toBeUndefined();
    }
  });

  it("makes no more talking videos than the plan's credits pay for", () => {
    const budget = cmoMonthPieceBudget("steady");
    expect(
      cmoTalkingVideoCount({
        level: "steady",
        slots: 400,
        fromShorts: true,
        held: 1,
        credits: budget - 300,
      }),
    ).toBe(2);
    expect(
      cmoTalkingVideoCount({
        level: "steady",
        slots: 400,
        fromShorts: true,
        held: 3,
        credits: budget + 1,
      }),
    ).toBe(3);
  });

  it("keeps the examples and counts them toward their network's rate and the shares", () => {
    const examples = [
      example("ex-1", { channel: "linkedin", pillar: "Token metadata" }),
      example("ex-2", {
        channel: "x",
        format: "image",
        pillar: "Fees and costs",
      }),
      example("ex-3", {
        channel: "tiktok",
        format: "video",
        alsoOn: ["instagram", "youtube"],
        pillar: "Market news",
        approach: "promotional",
        stage: "action",
      }),
    ];
    const base = plan({ calendar: examples });
    const without = slotsAt("steady");
    const slots = cmoPlanMonthSlots({
      plan: base,
      level: "steady",
      start: START,
    });
    expect(without.length - slots.length).toBe(examples.length);
    const month = [...examples, ...asEntries(slots)];
    expect(pillarProblems(base.pillars, month)).toEqual([]);
    expect(mixProblems(base.mix, month)).toEqual([]);
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(slots.length);
    expect(
      slots.some((slot) => examples.some((entry) => entry.id === slot.id)),
    ).toBe(false);
  });

  it("plans nothing more once the month is written, and only the rest after a short write", () => {
    const first = slotsAt("active");
    const written = asEntries(first);
    expect(
      cmoPlanMonthSlots({
        plan: plan({ calendar: written }),
        level: "active",
        start: START,
      }),
    ).toEqual([]);
    const short = written.filter((_, index) => index % 5 !== 0);
    const rest = cmoPlanMonthSlots({
      plan: plan({ calendar: short }),
      level: "active",
      start: START,
    });
    // A talking video's Facebook Reel that went missing comes back as a
    // Facebook post of its own: every network reaches what it did.
    const reach = (
      entries: Pick<CmoMonthSlot, "channel" | "format" | "alsoOn">[],
    ) => {
      const counts = new Map<string, number>();
      for (const entry of entries)
        for (const network of cmoSlotNetworks(entry))
          counts.set(network, (counts.get(network) ?? 0) + 1);
      return counts;
    };
    expect(reach([...short, ...rest])).toEqual(reach(first));
    const ids = [...short, ...rest].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("adds the bigger plan's posts on an upgrade, keeping the month", () => {
    const steady = asEntries(slotsAt("steady"));
    const more = cmoPlanMonthSlots({
      plan: plan({ calendar: steady }),
      level: "all_in",
      start: START,
    });
    expect(steady.length + more.length).toBe(slotsAt("all_in").length);
  });

  it("adds nothing on a downgrade: the bigger month holds the smaller one", () => {
    const scale = asEntries(slotsAt("all_in"));
    for (const level of ["steady", "active"] as const)
      expect(
        cmoPlanMonthSlots({
          plan: plan({ calendar: scale }),
          level,
          start: START,
        }),
      ).toEqual([]);
  });

  it("follows a cadence the owner lowered", () => {
    const slots = slotsAt(
      "all_in",
      plan({
        channels: [
          { channel: "x", cadence: "2 a day", setByOwner: true },
          { channel: "linkedin", cadence: "1 a day" },
        ],
      }),
    );
    expect(slots.filter((slot) => slot.channel === "x")).toHaveLength(56);
  });

  it("hands each pillar's research items out in turn", () => {
    const slots = cmoPlanMonthSlots({
      plan: plan(),
      level: "steady",
      start: START,
      seeds: new Map([["Launch planning", ["i1: one", "i2: two"]]]),
      proof: ["A drop sold out in an hour"],
    });
    const launch = slots.filter(
      (slot) =>
        slot.pillar === "Launch planning" && slot.approach !== "social-proof",
    );
    expect(new Set(launch.map((slot) => slot.seed))).toEqual(
      new Set(["i1: one", "i2: two"]),
    );
    expect(
      slots
        .filter((slot) => slot.approach === "social-proof")
        .every((slot) => slot.seed === "A drop sold out in an hour"),
    ).toBe(true);
  });
});

describe("cmoMonthChunks", () => {
  it("gives each call one network's week of at most 24 posts", () => {
    const slots = slotsAt("all_in");
    const chunks = cmoMonthChunks(slots, START, 24);
    expect(chunks.flat()).toHaveLength(slots.length);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(24);
      expect(new Set(chunk.map((slot) => slot.channel)).size).toBe(1);
    }
    // X at the top plan: 42 a week in two calls of 21.
    const x = chunks.filter((chunk) => chunk[0]?.channel === "x");
    expect(x.map((chunk) => chunk.length)).toEqual(Array(8).fill(21));
  });
});

describe("cmoQuota and cmoSpread", () => {
  it("counts whole shares that add up, after what is already there", () => {
    const weights = new Map([
      ["a", 60],
      ["b", 30],
      ["c", 10],
    ]);
    expect(Object.fromEntries(cmoQuota(weights, 10))).toEqual({
      a: 6,
      b: 3,
      c: 1,
    });
    expect(
      Object.fromEntries(cmoQuota(weights, 7, new Map([["a", 3]]))),
    ).toEqual({ a: 3, b: 3, c: 1 });
  });

  it("interleaves the keys", () => {
    expect(
      cmoSpread(
        new Map([
          ["a", 2],
          ["b", 1],
          ["c", 1],
        ]),
      ),
    ).toEqual(["a", "b", "c", "a"]);
  });
});
