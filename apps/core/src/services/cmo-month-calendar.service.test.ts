import type {
  CmoCalendarEntry,
  MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
const findRepeats = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("ai", async (actual) => ({
  ...(await actual<typeof import("ai")>()),
  generateText,
}));
vi.mock("@/lib/repeats", () => ({ findRepeats }));
vi.mock("@/services/brand-brain.service", () => ({
  compactBrandBrain: () => ({ summary: "NMKR mints tokens on Cardano" }),
  getBrandBrain: async () => null,
  parseBrandBrain: () => null,
}));
vi.mock("@/services/cmo-industry.service", () => ({
  cmoIndustryLine: (item: { id: string; point: string }) =>
    `${item.id} · ${item.point}`,
  readCmoIndustry: async () => ({
    items: [
      { id: "i1", point: "Royalties moved on-chain" },
      { id: "i2", point: "Mint fees fell" },
    ],
    topics: [],
  }),
}));
vi.mock("@/services/cmo-production.service", () => ({
  cmoPraiseOnly: async (points: string[]) => ({ points, costUsd: 0 }),
  cmoProofPoints: () => ["A drop sold out in an hour"],
}));
vi.mock("@/services/soko-bot-billing.service", () => ({
  recordSokoBotCheckUsage: vi.fn(async () => ({})),
}));

import {
  CMO_MONTH_CALENDAR_ATTEMPTS,
  CMO_MONTH_CALENDAR_MAX_ATTEMPTS,
  CMO_MONTH_CALENDAR_MODEL,
  CMO_MONTH_CALENDAR_RETRY_MS,
  CMO_MONTH_CALENDAR_STALE_MS,
  cmoMonthCalendarDue,
  cmoMonthCalendarOutOfTries,
  cmoMonthCalendarProblems,
  cmoMonthCalendarStopped,
  cmoMonthCalendarSystem,
  cmoMonthChunkPrompt,
  cmoMonthRepeats,
  cmoMonthStart,
  cmoPillarSeeds,
  cmoSlotEntry,
  writeCmoMonthCalendar,
} from "./cmo-month-calendar.service";
import type { CmoMonthSlot } from "./cmo-month-slots";

const START = "2026-12-01";

const slot = (id: string, overrides: Partial<CmoMonthSlot> = {}) =>
  ({
    id,
    date: START,
    time: "09:00",
    channel: "linkedin",
    format: "image",
    pillar: "Launch planning",
    approach: "educational",
    stage: "awareness",
    ...overrides,
  }) as CmoMonthSlot;

const examples: CmoCalendarEntry[] = [
  {
    id: "ex-1",
    date: START,
    time: "10:00",
    channel: "linkedin",
    format: "image",
    status: "idea",
    title: "Plan the mint day backwards",
    brief: "A checklist from launch day back to week one (i1).",
    approach: "educational",
    pillar: "Launch planning",
    stage: "awareness",
  },
];

function plan(overrides: Partial<MarketingStrategyPlan> = {}) {
  return {
    month: "2026-12",
    summary: "Launch help first, then the free account.",
    goals: ["More NMKR Studio projects"],
    pillars: [
      { name: "Launch planning", share: 50, why: "Rests on i1 and i2" },
      { name: "Fees and costs", share: 50, why: "i2" },
    ],
    mix: [
      { approach: "educational", share: 70, why: "Help with launches" },
      { approach: "promotional", share: 30, why: "The free account" },
    ],
    channels: [{ channel: "linkedin", cadence: "1 a day" }],
    calendar: examples,
    previews: [],
    changes: [],
    patched: [],
    funnel: [],
    questions: [],
    campaigns: [],
    improvements: [],
    proposals: [],
    beforeAfter: [],
    weeks: [],
    contentLanguage: "English",
    monthWriter: { state: "writing", attempts: 1 },
    ...overrides,
  } as unknown as MarketingStrategyPlan;
}

/** The model's answer: a post for every id the call names. */
function answerEvery(title = (id: string) => `Post ${id}`) {
  generateText.mockImplementation(async ({ prompt }: { prompt: string }) => {
    const ids = [...prompt.matchAll(/^- (m-[\w-]+) ·/gm)].map(
      (match) => match[1]!,
    );
    return {
      output: {
        posts: ids.map((id) => ({
          id,
          title: title(id),
          brief: `What ${id} says`,
          why: "Serves the launch pillar",
          claim: `Claim of ${id}`,
          story: null,
        })),
      },
      usage: { inputTokens: 1000, outputTokens: 500 },
      providerMetadata: {},
    };
  });
}

const context = (overrides: Partial<MarketingStrategyPlan> = {}) => ({
  cuso: {
    sokoBotId: "bot",
    projectId: "project",
    workspaceId: "workspace",
    businessName: "NMKR",
    websiteUrl: "https://nmkr.io",
  } as never,
  versionId: "version",
  plan: plan(overrides),
  level: "steady" as const,
  start: START,
  key: "test",
});

beforeEach(() => {
  generateText.mockReset();
  findRepeats.mockReset();
  findRepeats.mockImplementation(async (texts: string[]) => ({
    repeats: texts.map(() => null),
    costUsd: 0,
  }));
});

describe("writeCmoMonthCalendar", () => {
  it("writes every post of the month on the strong model, in parallel calls", async () => {
    answerEvery();
    const result = await writeCmoMonthCalendar(context());
    // LinkedIn at Starter: five a week, the example is one of week one's.
    expect(result.entries).toHaveLength(5 * 4 - 1);
    expect(result.missing).toBe(0);
    expect(generateText).toHaveBeenCalledTimes(4);
    for (const [call] of generateText.mock.calls)
      expect(call.model).toBeDefined();
    expect(
      generateText.mock.calls.every(
        ([call]) =>
          JSON.stringify(call.model).includes("gpt-6.2-sol") ||
          call.model === CMO_MONTH_CALENDAR_MODEL,
      ),
    ).toBe(true);
    // Every call shares one brief, so the provider caches it.
    expect(
      new Set(generateText.mock.calls.map(([call]) => call.system)).size,
    ).toBe(1);
  });

  it("keeps Core's pillar, approach and step whatever the model says", async () => {
    answerEvery();
    const { entries } = await writeCmoMonthCalendar(context());
    const pillars = new Map<string, number>();
    for (const entry of entries)
      pillars.set(entry.pillar!, (pillars.get(entry.pillar!) ?? 0) + 1);
    // With the example (Launch planning), 20 posts split 10 and 10.
    expect(pillars.get("Launch planning")).toBe(9);
    expect(pillars.get("Fees and costs")).toBe(10);
    expect(cmoMonthCalendarProblems(plan(), [...examples, ...entries])).toEqual(
      [],
    );
  });

  it("leaves a chunk that fails twice for the next write, and saves the rest", async () => {
    answerEvery();
    const answer = generateText.getMockImplementation()!;
    let calls = 0;
    generateText.mockImplementation(async (input: { prompt: string }) => {
      calls += 1;
      if (input.prompt.includes("2026-12-08")) throw new Error("timeout");
      return answer(input);
    });
    const result = await writeCmoMonthCalendar(context());
    expect(result.missing).toBe(5);
    expect(result.entries).toHaveLength(14);
    expect(calls).toBe(4 + 1);
  });

  it("rewrites a post that repeats another, and keeps the example", async () => {
    answerEvery((id) =>
      id.endsWith("20261202-1")
        ? "Plan the mint day backwards again"
        : `Post ${id}`,
    );
    findRepeats.mockImplementation(async (texts: string[], kind: string) => ({
      repeats: texts.map((text, index) =>
        kind === "title" && text.endsWith("again") && index > 0 ? 0 : null,
      ),
      costUsd: 0.001,
    }));
    const result = await writeCmoMonthCalendar(context());
    // Four weeks, then one repair call per round for the repeating post.
    expect(generateText).toHaveBeenCalledTimes(4 + 2);
    const repair = generateText.mock.calls.at(-1)?.[0] as { prompt: string };
    expect(repair.prompt.match(/^- m-/gm)).toHaveLength(1);
    expect(result.repeats).toBe(1);
    expect(
      result.entries.find((entry) => entry.id.endsWith("20261202-1"))?.title,
    ).toBe("Plan the mint day backwards again");
  });
});

describe("cmoMonthRepeats", () => {
  it("names the later of two titles saying one thing and claims past three", async () => {
    const entries = ["a", "b", "c", "d", "e"].map((id) => ({
      ...examples[0]!,
      id,
      title: id,
      claim: "one claim",
    }));
    const found = await cmoMonthRepeats(entries, async (texts, kind) => ({
      repeats: texts.map((_, index) =>
        kind === "title" ? (index === 1 ? 0 : null) : index === 0 ? null : 0,
      ),
      costUsd: 0,
    }));
    expect([...found.ids].sort()).toEqual(["b", "d", "e"]);
    // The repair is told what each repeated, and which point is spent.
    expect(found.repeated.get("b")).toBe('the title "a"');
    expect(found.repeated.get("d")).toBe('the point "one claim"');
    expect(found.spent.map((point) => point.claim)).toEqual(["one claim"]);
  });
});

describe("cmoSlotEntry", () => {
  it("takes the words and keeps Core's fields, without dashes", () => {
    const entry = cmoSlotEntry(
      slot("m-1", { approach: "social-proof", stage: "desire" }),
      {
        id: "m-1",
        title: "Sold out — in an hour",
        brief: "The drop",
        why: "Proof",
        claim: "A clear mint day sells",
        story: "A drop sold out in an hour",
      },
    );
    expect(entry).toMatchObject({
      id: "m-1",
      title: "Sold out, in an hour",
      pillar: "Launch planning",
      approach: "social-proof",
      stage: "desire",
      status: "idea",
      story: "A drop sold out in an hour",
    });
  });

  it("drops a post with no title or brief, and a story off social proof", () => {
    expect(cmoSlotEntry(slot("m-1"), undefined)).toBeNull();
    expect(
      cmoSlotEntry(slot("m-1"), {
        id: "m-1",
        title: "",
        brief: "x",
        why: "",
        claim: "",
        story: null,
      }),
    ).toBeNull();
    expect(
      cmoSlotEntry(slot("m-1"), {
        id: "m-1",
        title: "A tip",
        brief: "x",
        why: "",
        claim: "",
        story: "Invented",
      })?.story,
    ).toBeUndefined();
  });
});

describe("cmoMonthCalendarDue", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it("writes a month not yet written, and never one written for this plan", () => {
    expect(
      cmoMonthCalendarDue({ state: "examples", attempts: 0 }, "steady", now),
    ).toBe(true);
    expect(
      cmoMonthCalendarDue(
        { state: "written", level: "steady", attempts: 1 },
        "steady",
        now,
      ),
    ).toBe(false);
    // An upgrade writes the bigger plan's posts.
    expect(
      cmoMonthCalendarDue(
        { state: "written", level: "steady", attempts: 3, endedAt: ago(1000) },
        "all_in",
        now,
      ),
    ).toBe(true);
  });

  it("waits for a running write, and takes over one gone stale", () => {
    const running = {
      state: "writing" as const,
      level: "steady" as const,
      attempts: 1,
    };
    expect(
      cmoMonthCalendarDue(
        { ...running, startedAt: ago(60_000) },
        "steady",
        now,
      ),
    ).toBe(false);
    expect(
      cmoMonthCalendarDue(
        { ...running, startedAt: ago(CMO_MONTH_CALENDAR_STALE_MS) },
        "steady",
        now,
      ),
    ).toBe(true);
  });

  it("tries again at once, then every three hours once its tries ran out", () => {
    const ended = (attempts: number, ms: number) => ({
      state: "writing" as const,
      level: "steady" as const,
      attempts,
      startedAt: ago(ms + 60_000),
      endedAt: ago(ms),
    });
    expect(cmoMonthCalendarDue(ended(1, 1000), "steady", now)).toBe(true);
    expect(
      cmoMonthCalendarDue(
        ended(CMO_MONTH_CALENDAR_ATTEMPTS, 1000),
        "steady",
        now,
      ),
    ).toBe(false);
    expect(
      cmoMonthCalendarDue(
        ended(CMO_MONTH_CALENDAR_ATTEMPTS, CMO_MONTH_CALENDAR_RETRY_MS),
        "steady",
        now,
      ),
    ).toBe(true);
    // A day of three-hourly tries later, Core stops for this level.
    expect(
      cmoMonthCalendarDue(
        ended(CMO_MONTH_CALENDAR_MAX_ATTEMPTS, CMO_MONTH_CALENDAR_RETRY_MS),
        "steady",
        now,
      ),
    ).toBe(false);
    expect(
      cmoMonthCalendarDue(
        ended(CMO_MONTH_CALENDAR_MAX_ATTEMPTS, CMO_MONTH_CALENDAR_RETRY_MS),
        "all_in",
        now,
      ),
    ).toBe(true);
  });

  it("holds the cap when the eleventh write was interrupted and never ended", () => {
    const interrupted = {
      state: "writing" as const,
      level: "steady" as const,
      attempts: CMO_MONTH_CALENDAR_MAX_ATTEMPTS,
      startedAt: ago(CMO_MONTH_CALENDAR_STALE_MS + 60_000),
      endedAt: ago(CMO_MONTH_CALENDAR_STALE_MS + 4 * 60 * 60_000),
    };
    expect(cmoMonthCalendarDue(interrupted, "steady", now)).toBe(false);
    expect(cmoMonthCalendarOutOfTries(interrupted, "steady", now)).toBe(true);
    // A stale write with tries left is still taken over.
    expect(
      cmoMonthCalendarDue(
        { ...interrupted, attempts: CMO_MONTH_CALENDAR_ATTEMPTS },
        "steady",
        now,
      ),
    ).toBe(true);
    // The eleventh write still running is not out of tries yet.
    expect(
      cmoMonthCalendarOutOfTries(
        { ...interrupted, startedAt: ago(60_000) },
        "steady",
        now,
      ),
    ).toBe(false);
  });

  it("reads a stopped month as stopped only for its own plan level", () => {
    const stopped = {
      state: "stopped" as const,
      level: "steady" as const,
      attempts: CMO_MONTH_CALENDAR_MAX_ATTEMPTS,
    };
    expect(cmoMonthCalendarStopped(stopped, "steady")).toBe(true);
    expect(cmoMonthCalendarStopped(stopped, "all_in")).toBe(false);
    expect(cmoMonthCalendarDue(stopped, "steady", now)).toBe(false);
    expect(cmoMonthCalendarDue(stopped, "all_in", now)).toBe(true);
  });
});

describe("cmoMonthStart", () => {
  const now = new Date("2026-12-01T12:00:00Z");
  it("starts with the examples, never before tomorrow", () => {
    const at = (date: string) =>
      plan({ calendar: [{ ...examples[0]!, date }] });
    expect(cmoMonthStart(at("2026-12-04"), now)).toBe("2026-12-04");
    expect(cmoMonthStart(at("2026-11-28"), now)).toBe("2026-12-02");
    expect(cmoMonthStart(plan({ calendar: [] }), now)).toBe("2026-12-02");
  });
});

describe("cmoPillarSeeds", () => {
  it("hands a pillar the research items its why names, or its topic's", () => {
    const seeds = cmoPillarSeeds(
      plan({
        pillars: [
          { name: "Launch planning", share: 50, why: "Rests on i1 and i2" },
          { name: "Fees and costs", share: 50, why: "What a launch costs" },
        ],
      }),
      {
        items: [
          { id: "i1", point: "one" },
          { id: "i2", point: "two" },
          { id: "i3", point: "three" },
        ] as never,
        topics: [{ name: "Fees and costs", why: "", itemIds: ["i3"] }],
      },
    );
    expect(Object.fromEntries(seeds)).toEqual({
      "Launch planning": ["i1: one", "i2: two"],
      "Fees and costs": ["i3: three"],
    });
  });
});

describe("the brief", () => {
  it("shares the strategy, the examples and the research, and names what to avoid per call", () => {
    const system = cmoMonthCalendarSystem({
      businessName: "NMKR",
      websiteUrl: "https://nmkr.io",
      plan: plan(),
      brain: null,
      proof: [],
      industry: ["i1 · Royalties moved on-chain"],
    });
    expect(system).toContain("Plan the mint day backwards");
    expect(system).toContain("i1 · Royalties moved on-chain");
    expect(system).toContain("no post tells a customer story");
    const prompt = cmoMonthChunkPrompt(
      [slot("m-1", { seed: "i1: one" })],
      ["Plan the mint day backwards"],
    );
    expect(prompt).toContain(
      "m-1 · 2026-12-01 09:00 · linkedin image · pillar Launch planning · educational · awareness · Build on i1: one",
    );
    expect(prompt).toContain("Titles already in the month");
    expect(prompt).not.toContain("Repeated");
    const repair = cmoMonthChunkPrompt([slot("m-1")], [], {
      repeated: new Map([["m-1", 'the point "A clear mint day sells"']]),
      spent: ["A clear mint day sells"],
    });
    expect(repair).toContain(
      'Repeated the point "A clear mint day sells": make another point with another title',
    );
    expect(repair).toContain(
      "Points the month already makes as often as it may, which these must not argue again:\n- A clear mint day sells",
    );
  });
});
