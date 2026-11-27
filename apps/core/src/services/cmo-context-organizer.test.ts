import {
  type BrandBrain,
  isSokoBotCapability,
  type MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleFind = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotSchedule: { findUnique: scheduleFind } },
}));
vi.mock("@/services/cmo-billing.service", () => ({
  cmoPlanLevel: vi.fn(async () => "growth"),
}));
const emitted = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/lib/evlog", () => ({
  createCoreLogger: (context: Record<string, unknown>) => ({
    emit: () => emitted.push(context),
  }),
}));

import type { CmoContextSources } from "@/services/cmo-context.service";
import {
  CMO_KIND_TOOLS,
  type CmoContextLog,
  type CmoContextPicker,
  cmoNamedDays,
  cmoShortFormsFor,
  cmoTurnKind,
  organizeCmoContext,
  organizerJevTimeoutMs,
} from "./cmo-context-organizer";

const NOW = new Date("2026-12-01T08:00:00Z");
const DAY_MS = 86_400_000;
const CHANNELS = ["x", "linkedin", "instagram", "facebook", "tiktok"];

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

/** A Brand Brain the size of NMKR's: every section with long findings. */
function bigBrain(): BrandBrain {
  const finding = (index: number) => ({
    text: `Finding ${index}: ${"the business sells minting and token tooling to creators and studios. ".repeat(3)}`,
    implication: `So what ${index}: lead with the outcome creators get, in their words.`,
    source: "https://example.com/about",
  });
  const sections = [
    "company",
    "offer",
    "problems",
    "customers",
    "buyers",
    "value",
    "pricing",
    "positioning",
    "competition",
    "sales",
    "marketing",
    "content",
    "proof",
    "reputation",
    "momentum",
    "opportunities",
  ];
  return {
    summary: "NMKR-like: a platform to mint, sell and manage digital assets.",
    voice: { tone: "Plain and confident", dos: ["Be specific"], donts: [] },
    audience: ["Creators", "Studios", "Brands"],
    products: ["Studio", "Pay", "API"],
    competitors: [],
    alternatives: [],
    questions: [],
    profile: Object.fromEntries(
      sections.map((section) => [
        section,
        {
          headline: `${section} headline in a few words`,
          answer: `${section}: ${"a long answer about this part of the business. ".repeat(6)}`,
          findings: Array.from({ length: 8 }, (_, index) => finding(index)),
          openQuestions: [],
        },
      ]),
    ),
  } as unknown as BrandBrain;
}

/** A month of `count` pieces from today, spread over five networks. */
function bigPlan(count: number): MarketingStrategyPlan {
  const pillars = ["Creator economics", "Token launches", "Studio how-tos"];
  return {
    month: "2026-12",
    summary: "Grow creators' launches on NMKR.",
    goals: ["More launches"],
    pillars: pillars.map((name, index) => ({
      name,
      share: index === 0 ? 40 : 30,
    })),
    channels: CHANNELS.map((channel) => ({
      channel,
      cadence: "3 posts a day",
    })),
    mix: [
      { approach: "educational", share: 60 },
      { approach: "promotional", share: 40 },
    ],
    funnel: [],
    campaigns: [],
    previews: [],
    changes: [],
    patched: [],
    questions: [],
    calendar: Array.from({ length: count }, (_, index) => ({
      id: `piece-${index}`,
      date: new Date(NOW.getTime() + Math.floor(index / 23) * DAY_MS)
        .toISOString()
        .slice(0, 10),
      time: "09:00",
      channel: CHANNELS[index % CHANNELS.length] as string,
      format: "post",
      title: `Piece ${index} about a creator's launch and what it earned`,
      status: "drafted",
      pillar: pillars[index % pillars.length],
      stage: "attention",
      brief: "A long brief ".repeat(20),
      draft: "A long draft ".repeat(40),
    })),
  } as unknown as MarketingStrategyPlan;
}

function sources(
  overrides: Partial<CmoContextSources> = {},
): CmoContextSources {
  return {
    cuso: {
      projectId: "project-1",
      businessName: "NMKR",
      websiteUrl: "https://nmkr.io",
      brandBrain: null,
    } as unknown as CmoContextSources["cuso"],
    versionId: "cmo-v23",
    strategyVersion: {
      approvedAt: NOW,
    } as unknown as CmoContextSources["strategyVersion"],
    strategy: bigPlan(697),
    brandBrain: bigBrain(),
    project: {
      logo: "https://example.com/logo.png",
      designMdUrl: null,
      presenterFileId: null,
      presenterConsentAt: null,
    },
    designMd: "# Design\n".repeat(200),
    brandPictures: Array.from({ length: 12 }, (_, index) => ({
      fileId: `file-${index}`,
      alt: `A photo of the studio number ${index}`,
      fromSite: false,
    })) as unknown as CmoContextSources["brandPictures"],
    reports: Array.from({ length: 8 }, (_, index) => ({
      id: `report-${index}`,
      at: new Date(NOW.getTime() - index * DAY_MS).toISOString(),
      kind: index === 7 ? "weekly" : "daily",
      headline: `Report ${index}`,
      done: ["Did things"],
      upNext: [],
      changes: [],
      turnId: null,
      ...(index === 7 ? { learnings: ["Numbers first wins"] } : {}),
    })) as unknown as CmoContextSources["reports"],
    competitorMoves: Array.from({ length: 10 }, (_, index) => ({
      checkedOn: "2026-11-28",
      competitor: `Rival ${index}`,
      happened: "Launched a new pricing page. ".repeat(4),
      meaning: "Buyers compare prices.",
      move: "Answer with our own pricing post.",
    })) as unknown as CmoContextSources["competitorMoves"],
    channels: CHANNELS.map((provider, index) => ({
      id: `connection-${index}`,
      provider,
      externalHandle: `@nmkr_${provider}`,
      status: "active",
    })) as unknown as CmoContextSources["channels"],
    existingAccounts: CHANNELS,
    subscriptionActive: true,
    sitePages: {
      complete: true,
      pages: Array.from({ length: 40 }, (_, index) => ({
        url: `https://nmkr.io/page-${index}`,
        title: `Page ${index}`,
        summary: "What this page says about minting. ".repeat(4),
        noteFileId: `note-${index}`,
      })),
    } as unknown as CmoContextSources["sitePages"],
    industry: {
      researchedAt: "2026-11-20T00:00:00Z",
      industry: "Digital assets",
      buyer: "Creators",
      items: Array.from({ length: 30 }, (_, index) => ({
        id: `i${index}`,
        kind: "news",
        text: "A sourced industry item about creators and tokens. ".repeat(3),
        source: { url: "https://news.example/item", title: "News" },
        date: "2026-11-18",
      })),
      topics: [],
    } as unknown as CmoContextSources["industry"],
    ...overrides,
  };
}

const chat = (message: string) => ({
  source: "CHAT",
  clientTurnId: "chat:1",
  message,
});

function logOf(context: Record<string, unknown>): CmoContextLog {
  return context.organizer as CmoContextLog;
}

describe("cmoTurnKind", () => {
  it("reads the kind from Core's own ids and the rhythm's key", () => {
    expect(
      cmoTurnKind(
        { source: "EVENT", clientTurnId: "cmo:production:b:1:2" },
        null,
      ),
    ).toBe("production");
    expect(
      cmoTurnKind({ source: "EVENT", clientTurnId: "cmo:strategy:b:1" }, null),
    ).toBe("strategy");
    expect(
      cmoTurnKind(
        { source: "SCHEDULE", clientTurnId: "schedule:x:y" },
        "cmo-daily-run",
      ),
    ).toBe("daily");
    expect(
      cmoTurnKind(
        { source: "SCHEDULE", clientTurnId: "schedule:x:y" },
        "cmo-monthly-strategy",
      ),
    ).toBe("strategy");
    expect(cmoTurnKind({ source: "CHAT", clientTurnId: "chat:1" }, null)).toBe(
      "chat",
    );
    expect(cmoTurnKind({ source: "CHAT", clientTurnId: "watch:1" }, null)).toBe(
      "event",
    );
    expect(
      cmoTurnKind({ source: "EVENT", clientTurnId: "cmo:competitors:1" }, null),
    ).toBe("competitors");
  });
});

describe("organizerJevTimeoutMs", () => {
  it("waits for the plan's stand-in longer than for Jev", () => {
    expect(organizerJevTimeoutMs({})).toBe(4_000);
    expect(
      organizerJevTimeoutMs({ SOKO_BOT_LOCAL_CHATGPT_PLAN: "1" }),
    ).toBeGreaterThanOrEqual(30_000);
  });
});

describe("organizeCmoContext", () => {
  beforeEach(() => {
    emitted.length = 0;
    scheduleFind.mockReset();
  });

  it("gives the picker the plan allowance only on plan runs", async () => {
    const asked: number[] = [];
    const picker: CmoContextPicker = async ({ timeoutMs }) => {
      asked.push(timeoutMs);
      return new Map();
    };
    const pick = () =>
      organizeCmoContext({
        sources: sources(),
        turn: chat("What should we post this week?"),
        now: NOW,
        picker,
      });
    await pick();
    vi.stubEnv("SOKO_BOT_LOCAL_CHATGPT_PLAN", "1");
    try {
      await pick();
    } finally {
      vi.unstubAllEnvs();
    }
    expect(asked).toEqual([
      4_000,
      organizerJevTimeoutMs({ SOKO_BOT_LOCAL_CHATGPT_PLAN: "1" }),
    ]);
  });

  it("keeps the core small and maps everything stored", async () => {
    const context = await organizeCmoContext({
      sources: sources(),
      turn: chat("Thanks!"),
      now: NOW,
      picker: async () => new Map(),
    });
    const core = context.core as { map: { id: string }[] };
    expect(bytes(core)).toBeLessThan(8 * 1_024);
    const ids = core.map.map((item) => item.id);
    expect(ids).toContain("brand:essentials");
    expect(ids).toContain("strategy:channels");
    expect(ids).toContain(`calendar:2026-12-01..2026-12-07`);
    expect(ids.some((id) => id.startsWith("report:"))).toBe(true);
    // A thank-you picks nothing on top of the core.
    expect(context.picked).toEqual([]);
    expect(emitted[0]?.operation).toBe("cmo_context_organized");
  });

  it("gives a production run the brand, never the calendar", async () => {
    const context = await organizeCmoContext({
      sources: sources(),
      turn: {
        source: "EVENT",
        clientTurnId: "cmo:production:bot:1:0",
        message: "Background run: make NMKR's month",
      },
      now: NOW,
      picker: async () => {
        throw new Error("a production run never asks Jev");
      },
    });
    const log = logOf(context);
    expect(log.kind).toBe("production");
    expect(log.picked.map((pick) => pick.id)).toEqual(
      expect.arrayContaining(["brand:essentials", "brand:look"]),
    );
    expect(log.picked.some((pick) => pick.id.startsWith("calendar:"))).toBe(
      false,
    );
    expect(log.jev).toBeNull();
    expect(log.pickedBytes).toBeLessThanOrEqual(16 * 1_024);
  });

  it("adds what Jev picks, cut to the budget with the rest counted", async () => {
    const picker: CmoContextPicker = async ({ topics }) =>
      new Map(
        Object.entries(topics).map(([key, title]) => [
          key,
          title.startsWith("calendar week 3") ? 0.92 : 0.1,
        ]),
      );
    const context = await organizeCmoContext({
      sources: sources(),
      turn: chat("What goes out in the week of the 15th?"),
      now: NOW,
      picker,
    });
    const log = logOf(context);
    const week = log.picked.find((pick) => pick.id.startsWith("calendar:"));
    expect(week?.id).toBe("calendar:2026-12-15..2026-12-21");
    expect(week?.why).toBe("jev 0.92");
    // 161 pieces a week do not fit: the lines stop and say how to read more.
    expect(week?.cut).toBe(true);
    const shown = (context.picked as { content: { more?: string } }[])[0];
    expect(shown?.content.more).toMatch(
      /more: read_calendar from 2026-12-15 to 2026-12-21/,
    );
    expect(log.pickedBytes).toBeLessThanOrEqual(12 * 1_024);
  });

  it("caps Jev's picks at six", async () => {
    const context = await organizeCmoContext({
      sources: sources({ strategy: bigPlan(20) }),
      turn: chat("Tell me everything"),
      now: NOW,
      picker: async ({ topics }) =>
        new Map(Object.keys(topics).map((key) => [key, 0.9])),
    });
    const log = logOf(context);
    expect(
      log.picked.filter((pick) => pick.why.startsWith("jev")).length +
        log.dropped.length,
    ).toBeLessThanOrEqual(6);
  });

  it("falls back to the brand, this week and the newest report when Jev fails", async () => {
    const context = await organizeCmoContext({
      sources: sources({ strategy: bigPlan(20) }),
      turn: chat("What should we do next?"),
      now: NOW,
      picker: async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    });
    const log = logOf(context);
    expect(log.jev?.failed).toBe("TimeoutError");
    expect(log.picked.map((pick) => [pick.id, pick.why])).toEqual([
      ["brand:essentials", "fallback"],
      ["calendar:2026-12-01..2026-12-07", "fallback"],
      ["report:report-0", "fallback"],
    ]);
  });

  it("keeps the whole fitted context for a strategy turn", async () => {
    const context = await organizeCmoContext({
      sources: sources(),
      turn: {
        source: "EVENT",
        clientTurnId: "cmo:strategy:bot:1",
        message: "Write the strategy",
      },
      now: NOW,
    });
    expect(context.brandBrain).toBeDefined();
    expect(context.strategy).toBeDefined();
    expect(context.core).toBeDefined();
    expect(bytes(context)).toBeLessThan(34 * 1_024);
  });

  it("reads a rhythm's kind from its schedule", async () => {
    scheduleFind.mockResolvedValue({ systemKey: "cmo-daily-run" });
    const context = await organizeCmoContext({
      sources: sources(),
      turn: {
        source: "SCHEDULE",
        clientTurnId:
          "schedule:0195a7a0-0000-7000-8000-000000000001:2026-12-01T09:00:00.000Z",
        message: "Daily marketing run",
      },
      now: NOW,
      picker: async () => new Map(),
    });
    const log = logOf(context);
    expect(log.kind).toBe("daily");
    expect(log.picked[0]?.id).toBe("brand:essentials");
    expect(log.picked.at(-1)?.id).toBe("calendar:2026-12-01..2026-12-07");
  });

  // Owner, 2026-11-25: an NMKR-size month (697 pieces) and Brand Brain once
  // failed every turn; no kind of turn may grow past its budget.
  it("never overflows with an NMKR-size month and Brand Brain", async () => {
    const picker: CmoContextPicker = async ({ topics }) =>
      new Map(Object.keys(topics).map((key) => [key, 0.99]));
    for (const [source, clientTurnId] of [
      ["CHAT", "chat:1"],
      ["EVENT", "cmo:production:bot:1:0"],
      ["EVENT", "cmo:competitors:1"],
      ["EVENT", "watch:1"],
      ["EVENT", "cmo:strategy:bot:1"],
    ] as const) {
      const context = await organizeCmoContext({
        sources: sources(),
        turn: { source, clientTurnId, message: "Everything please" },
        now: NOW,
        picker,
      });
      expect(bytes(context)).toBeLessThan(36 * 1_024);
    }
  });
});

describe("cmoNamedDays", () => {
  // Tuesday 1 Dec 2026.
  it("reads the days a message names", () => {
    expect(cmoNamedDays("What goes out the week of December 14?", NOW)).toEqual(
      ["2026-12-14"],
    );
    expect(cmoNamedDays("Move the 3rd of January post", NOW)).toEqual([
      "2027-01-03",
    ]);
    expect(cmoNamedDays("Change Saturday's 09:00 X post", NOW)).toEqual([
      "2026-12-05",
    ]);
    expect(cmoNamedDays("and tomorrow, 2026-12-20 too", NOW)).toEqual([
      "2026-12-02",
      "2026-12-20",
    ]);
    expect(cmoNamedDays("May I ask how the week went?", NOW)).toEqual([]);
  });
});

describe("organizeCmoContext on a named day", () => {
  it("brings the week of a day the message names, whatever Jev says", async () => {
    const context = await organizeCmoContext({
      sources: sources(),
      turn: chat("What are we posting on LinkedIn the week of December 14?"),
      now: NOW,
      picker: async () => new Map(),
    });
    expect(logOf(context).picked.map((pick) => [pick.id, pick.why])).toEqual([
      ["calendar:2026-12-08..2026-12-14", "named day"],
    ]);
  });

  it("gives a production run the site's pages before the industry", async () => {
    const context = await organizeCmoContext({
      sources: sources(),
      turn: {
        source: "EVENT",
        clientTurnId: "cmo:production:bot:1:0",
        message: "Background run",
      },
      now: NOW,
    });
    const ids = logOf(context).picked.map((pick) => pick.id);
    expect(ids.slice(0, 3)).toEqual([
      "brand:essentials",
      "brand:look",
      "sitePages",
    ]);
    expect(logOf(context).pickedBytes).toBeLessThanOrEqual(20 * 1_024);
  });
});

describe("organizeCmoContext with tool highlights (cmo-v24)", () => {
  const answering =
    (change: number): CmoContextPicker =>
    async ({ topics }) =>
      new Map(
        Object.keys(topics).map((key) => [key, key === "change" ? change : 0]),
      );

  it("names only tools Cuso has", () => {
    for (const tools of Object.values(CMO_KIND_TOOLS))
      for (const name of tools) expect(isSokoBotCapability(name)).toBe(true);
  });

  it("names the kind's tools in the core", async () => {
    const context = await organizeCmoContext({
      sources: sources(),
      turn: chat("What goes out on Friday?"),
      now: NOW,
      picker: answering(0.1),
      highlights: true,
    });
    expect(
      (context.core as { toolsForThisTurn?: string }).toolsForThisTurn,
    ).toBe(CMO_KIND_TOOLS.chat.join(", "));
  });

  it("names write_strategy first when Core writes the strategy (cmo-v26)", async () => {
    const context = await organizeCmoContext({
      sources: sources(),
      turn: chat("Drop Instagram from the plan."),
      now: NOW,
      picker: answering(0.9),
      highlights: true,
      strategyStep: true,
    });
    expect(
      (context.core as { toolsForThisTurn?: string }).toolsForThisTurn,
    ).toBe(["write_strategy", ...CMO_KIND_TOOLS.chat].join(", "));
  });

  it("gives a question short save tools and a change request the full ones", async () => {
    const question = await organizeCmoContext({
      sources: sources(),
      turn: chat("What goes out on Friday?"),
      now: NOW,
      picker: answering(0.1),
      highlights: true,
    });
    const change = await organizeCmoContext({
      sources: sources(),
      turn: chat("Move Friday's LinkedIn post to Monday."),
      now: NOW,
      picker: answering(0.94),
      highlights: true,
    });
    expect(logOf(question).change).toBe(false);
    expect(cmoShortFormsFor(logOf(question))).toBe(true);
    expect(logOf(change).change).toBe(true);
    expect(cmoShortFormsFor(logOf(change))).toBe(false);
  });

  it("keeps the full save tools when Jev fails, and on saving kinds", async () => {
    const failed = await organizeCmoContext({
      sources: sources(),
      turn: chat("What goes out on Friday?"),
      now: NOW,
      picker: async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
      highlights: true,
    });
    expect(cmoShortFormsFor(logOf(failed))).toBe(false);
    for (const kind of ["production", "strategy", "daily", "weekly", "brand"])
      expect(cmoShortFormsFor({ kind, change: false })).toBe(false);
    expect(cmoShortFormsFor(null)).toBe(false);
  });

  it("asks Jev nothing new and names no tools without highlights", async () => {
    let asked: string[] = [];
    const context = await organizeCmoContext({
      sources: sources(),
      turn: chat("What goes out on Friday?"),
      now: NOW,
      picker: async ({ topics }) => {
        asked = Object.keys(topics);
        return new Map();
      },
    });
    expect(asked).not.toContain("change");
    expect(logOf(context).change).toBeUndefined();
    expect(context.core).not.toHaveProperty("toolsForThisTurn");
  });
});
