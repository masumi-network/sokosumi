import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionFindMany,
  cusoFind,
  fileLinkFindMany,
  messageFindMany,
  postFindMany,
  projectFindUnique,
  resetCmoServiceMocks,
  seedStrategy,
  strategy,
  subscriptionFindFirst,
} from "@/test-fixtures/cmo-service";

const readDesignMd = vi.hoisted(() => vi.fn());
const recentCompetitorMoves = vi.hoisted(() =>
  vi.fn(async () => [] as unknown[]),
);
vi.mock("@/services/competitor-feed.service", () => ({
  recentCompetitorMoves,
}));
vi.mock("@/lib/design-md-blob", () => ({
  readDesignMdContent: readDesignMd,
  uploadDesignMdContent: vi.fn(),
}));

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

import {
  CMO_CONTEXT_BUDGET_BYTES,
  fitCmoMarketingContext,
  loadCmoMarketingContext,
} from "./cmo-context.service";

beforeEach(resetCmoServiceMocks);

describe("loadCmoMarketingContext", () => {
  it("gives Cuso the Project's logo, DESIGN.md and Brand research pictures", async () => {
    const { loadCmoMarketingContext } = await import("./cmo-context.service");
    cusoFind.mockResolvedValue({
      sokoBotId: "bot-1",
      projectId: "project-1",
      brandBrain: null,
      mockPlan: null,
      updates: [],
    });
    subscriptionFindFirst.mockResolvedValue(null);
    connectionFindMany.mockResolvedValue([]);
    projectFindUnique.mockResolvedValue({
      logo: "https://blob.example/logo.png",
      designMdUrl: "https://blob.example/DESIGN.md",
    });
    readDesignMd.mockResolvedValue('---\nname: Acme\n---\nPrimary: "#ff6a00"');
    const research = "drive/organizations/org-1/Brand research";
    fileLinkFindMany.mockResolvedValue([
      {
        resource: {
          id: "f-shoe",
          sourceId: `${research}/Pictures/01-red-shoe.jpg`,
        },
      },
      { resource: { id: "f-home", sourceId: `${research}/home.jpg` } },
    ]);

    const context = await loadCmoMarketingContext("bot-1");

    expect(context).toMatchObject({
      brandLook: {
        logoUrl: "https://blob.example/logo.png",
        designMd: '---\nname: Acme\n---\nPrimary: "#ff6a00"',
      },
      brandPictures: [
        { fileId: "f-home", alt: "Home page screenshot" },
        { fileId: "f-shoe", alt: "red shoe" },
      ],
      writingSkills: expect.arrayContaining([
        expect.objectContaining({ id: "brand-voice", name: "Brand voice" }),
        expect.objectContaining({ id: "linkedin", use: expect.any(String) }),
      ]),
    });
    expect(context).not.toHaveProperty("brandVisual");
    // The list names each skill; read_writing_skill brings its words.
    expect(JSON.stringify(context?.writingSkills)).not.toContain(
      "## Before you save",
    );
    expect(projectFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "project-1" } }),
    );
  });
});

describe("buildCmoBeatPacket", () => {
  it("stays well under the message limit with a long plan", async () => {
    const { buildCmoBeatPacket } = await import("./cmo-context.service");
    const long = "x".repeat(2_000);
    cusoFind.mockResolvedValue({
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
      businessName: "Acme",
      websiteUrl: "https://acme.io",
      goals: "More leads",
      brandBrain: { summary: long },
      updates: [],
    });
    seedStrategy(
      {
        ...strategy,
        calendar: Array.from({ length: 30 }, (_, index) => ({
          ...strategy.calendar[0],
          id: `e${index}`,
          title: long,
        })),
      },
      { approvedAt: new Date("2026-10-01T09:00:00Z") },
    );
    subscriptionFindFirst.mockResolvedValue(null);
    connectionFindMany.mockResolvedValue([]);
    postFindMany.mockResolvedValue([]);
    const { packet, skip } = await buildCmoBeatPacket(
      "bot-1",
      new Date("2026-10-06T07:00:00Z"),
      "cmo-daily-run",
    );
    expect(skip).toBe(false);
    expect(packet).toContain("workspace.marketing");
    expect(packet.length).toBeLessThan(5_000);
  });
});

describe("loadCmoMarketingContext", () => {
  it("shows a rhythm the approved version and every other turn the newest draft", async () => {
    cusoFind.mockResolvedValue({
      workspaceId: "ws-1",
      projectId: "project-1",
      websiteUrl: "https://acme.io",
      brandBrain: null,
      mockPlan: null,
      updates: [],
    });
    connectionFindMany.mockResolvedValue([]);
    seedStrategy(strategy, { approvedAt: new Date("2026-10-01T09:00:00Z") });
    seedStrategy({ ...strategy, summary: "A draft waiting for approval." });
    const now = new Date("2026-10-06T07:00:00Z");

    const rhythm = await loadCmoMarketingContext("bot-1", now, {
      executing: true,
    });
    const chat = await loadCmoMarketingContext("bot-1", now);

    expect(rhythm).toMatchObject({
      strategyApproved: true,
      strategy: { summary: strategy.summary },
    });
    expect(chat).toMatchObject({
      strategyApproved: false,
      strategy: { summary: "A draft waiting for approval." },
    });
  });

  it("gives Cuso his latest reports from the cards in his room", async () => {
    cusoFind.mockResolvedValue({
      workspaceId: "ws-1",
      projectId: "project-1",
    });
    subscriptionFindFirst.mockResolvedValue(null);
    connectionFindMany.mockResolvedValue([]);
    messageFindMany.mockResolvedValue([
      {
        id: "message-1",
        createdAt: new Date("2026-10-05T09:03:00Z"),
        metadata: {
          cmo_report: {
            kind: "weekly",
            headline: "Week 1",
            done: [],
            upNext: [],
            changes: [],
            previousVersionId: "strategy-0",
          },
        },
      },
    ]);
    const context = await loadCmoMarketingContext("bot-1");
    expect(messageFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { senderSokoBotId: "bot-1" },
      take: 60,
    });
    expect(context?.recentUpdates).toEqual([
      expect.objectContaining({ id: "message-1", headline: "Week 1" }),
    ]);
    expect(JSON.stringify(context)).not.toContain("previousVersionId");
  });

  it("gives Cuso the competitor moves of the last weeks, and none when quiet", async () => {
    cusoFind.mockResolvedValue({ workspaceId: "ws-1", projectId: "project-1" });
    subscriptionFindFirst.mockResolvedValue(null);
    connectionFindMany.mockResolvedValue([]);
    messageFindMany.mockResolvedValue([]);
    expect(await loadCmoMarketingContext("bot-1")).not.toHaveProperty(
      "competitorMoves",
    );
    const move = {
      week: "2026-11-16",
      competitor: "Calendly",
      happened: "Calendly raised Standard from $10 to $12 per seat.",
      meaning: "Our Teams plan is now cheaper for small teams.",
      move: "Lead with the price per seat.",
    };
    recentCompetitorMoves.mockResolvedValueOnce([move]);
    const context = await loadCmoMarketingContext("bot-1");
    expect(recentCompetitorMoves).toHaveBeenCalledWith(
      "project-1",
      expect.any(Date),
    );
    expect(context?.competitorMoves).toEqual([move]);
  });
});

describe("fitCmoMarketingContext", () => {
  const now = new Date("2026-11-01T09:00:00Z");
  const entry = (id: string, date: string) => ({
    id,
    date,
    channel: "instagram",
    format: "image",
    title: `Piece ${id}`,
    status: "draft",
    draft: "x".repeat(600),
    brief: "y".repeat(200),
  });
  const context = {
    brandBrain: { summary: "A shop", profile: {} },
    strategy: {
      summary: "Plan",
      weeks: ["w".repeat(2_000)],
      calendar: [entry("soon", "2026-11-02"), entry("later", "2026-11-20")],
    },
  };

  it("leaves a context that fits alone", () => {
    expect(fitCmoMarketingContext(context, now, 100_000)).toBe(context);
  });

  it("sheds later drafts first, then secondary plan parts, keeping the next days whole", () => {
    const fitted = fitCmoMarketingContext(context, now, 2_000) as {
      strategy: {
        calendar: Record<string, unknown>[];
        storedNotShown?: string[];
      };
    };
    const [soon, later] = fitted.strategy.calendar;
    expect(soon?.draft).toBeDefined();
    expect(later?.draft).toBeUndefined();
    expect(later?.detailsStored).toBe(true);
    expect(fitted.strategy.storedNotShown).toContain("weeks");
  });

  it("sheds a later piece's visual with its draft, and keeps only two weeks last", () => {
    const withVisual = (id: string, date: string) => ({
      ...entry(id, date),
      visual: "v".repeat(400),
      visualFileIds: ["file-1"],
    });
    const big = {
      ...context,
      strategy: {
        ...context.strategy,
        calendar: [
          withVisual("soon", "2026-11-02"),
          withVisual("later", "2026-11-10"),
          withVisual("far", "2026-11-25"),
        ],
      },
    };
    const shed = fitCmoMarketingContext(big, now, 2_600) as {
      strategy: { calendar: Record<string, unknown>[] };
    };
    expect(shed.strategy.calendar[0]?.visual).toBeDefined();
    expect(shed.strategy.calendar[1]?.visual).toBeUndefined();
    const twoWeeks = fitCmoMarketingContext(big, now, 1_700) as {
      strategy: { calendar: Record<string, unknown>[] };
    };
    expect(twoWeeks.strategy.calendar.map((piece) => piece.id)).toEqual([
      "soon",
      "later",
    ]);
  });

  it("always fits a top-volume month: NMKR's 116 pieces, 80 of them in two weeks", () => {
    const channels = ["x", "x", "x", "linkedin", "instagram", "facebook"];
    const month = {
      brandBrain: {
        summary: "s".repeat(400),
        competitors: Array.from({ length: 6 }, () => "c".repeat(220)),
        marketingToday: { summary: "m".repeat(1_400) },
        offers: "o".repeat(800),
        voice: "v".repeat(500),
        profile: {},
      },
      brandLook: { designMd: "d".repeat(1_600) },
      brandPictures: Array.from({ length: 20 }, (_, i) => ({
        fileId: `01a1f567-f147-734d-8c4d-0786f2e0c0${String(i).padStart(2, "0")}`,
        alt: "a".repeat(80),
        kind: "screenshot",
      })),
      writingSkills: Array.from({ length: 14 }, (_, i) => ({
        id: `skill-${i}`,
        use: "u".repeat(110),
      })),
      strategy: {
        summary: "Plan",
        channels: "h".repeat(800),
        pillars: "p".repeat(500),
        mix: "x".repeat(500),
        questions: "q".repeat(400),
        focus: "f".repeat(400),
        funnel: "f".repeat(3_000),
        patched: Array.from({ length: 60 }, (_, i) => ({
          id: `w2-x${i}`,
          was: null,
        })),
        start: { gaps: ["g".repeat(800)] },
        campaigns: [{ id: "conference-notes", message: "l".repeat(900) }],
        calendar: Array.from({ length: 116 }, (_, i) => ({
          id: `w${Math.floor(i / 29) + 1}-x${String(i).padStart(2, "0")}`,
          date: `2026-11-${String(Math.floor(i / 5.8) + 2).padStart(2, "0")}`,
          time: "07:20",
          channel: channels[i % channels.length],
          format: "post",
          approach: "product-led",
          pillar: "Project launch workflows",
          campaignId: "conference-notes",
          status: "idea",
          title: "Prepare sale choices before the mint",
          brief: "List buyer steps before choosing sale settings for the drop.",
          why: "A practical prompt for UBC 2026, Nov 20-21.",
        })),
      },
    };
    const fitted = fitCmoMarketingContext(month, now) as {
      strategy: { calendar?: Record<string, unknown>[] };
    };
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(
      CMO_CONTEXT_BUDGET_BYTES,
    );
    expect(fitted.strategy.calendar?.[0]?.id).toBe("w1-x00");
  });

  it("ends within its budget even when the calendar has to go", () => {
    const fitted = fitCmoMarketingContext(context, now, 200) as {
      strategy: { calendar?: unknown[]; storedNotShown?: string[] };
    };
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(200);
    expect(fitted.strategy.storedNotShown).toContain("calendar");
  });

  it("keeps every later piece as a short line before it drops any, so a change can reach weeks three and four", () => {
    const month = {
      brandBrain: { summary: "A shop", profile: {} },
      strategy: {
        summary: "Plan",
        calendar: Array.from({ length: 28 }, (_, day) => ({
          ...entry(`e${day}`, `2026-11-${String(day + 2).padStart(2, "0")}`),
          pillar: "Team booking",
          campaignId: "trial",
          why: "z".repeat(120),
        })),
      },
    };
    const fitted = fitCmoMarketingContext(month, now, 6_600) as {
      strategy: { calendar: Record<string, unknown>[] };
    };
    expect(fitted.strategy.calendar).toHaveLength(28);
    const far = fitted.strategy.calendar.at(-1);
    expect(Object.keys(far ?? {}).sort()).toEqual(
      ["channel", "date", "format", "id", "status", "title"].sort(),
    );
  });

  it("sheds the Brand Brain's open questions and profile answers before any calendar entry", () => {
    // marketingToday stays: the plan's before/after rows are written from it.
    const month = {
      brandBrain: {
        summary: "A shop",
        questions: ["q".repeat(1_500)],
        marketingToday: { summary: "m".repeat(300) },
        profile: { buyers: { headline: "Teams", answer: "a".repeat(3_000) } },
      },
      strategy: {
        summary: "Plan",
        calendar: Array.from({ length: 28 }, (_, day) =>
          entry(`e${day}`, `2026-11-${String(day + 2).padStart(2, "0")}`),
        ),
      },
    };
    const fitted = fitCmoMarketingContext(month, now, 7_000) as {
      brandBrain: Record<string, unknown> & {
        profile: Record<string, Record<string, unknown>>;
      };
      strategy: { calendar: unknown[] };
    };
    expect(fitted.strategy.calendar).toHaveLength(28);
    expect(fitted.brandBrain.questions).toBeUndefined();
    expect(fitted.brandBrain.marketingToday).toBeDefined();
    expect(fitted.brandBrain.profile.buyers).toEqual({ headline: "Teams" });
  });
});
