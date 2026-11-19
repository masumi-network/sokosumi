/**
 * Real-Postgres proof of Cuso's competitor feed: a save is checked against
 * the Project's stored signals and refused whole when a fact rests on
 * nothing; a saved week names its big moves; "Add to strategy" patches the
 * strategy once; and the watch run starts once per check.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-competitor-feed.postgres.test.ts
 *
 * Jev, the strategy request and the turn start are mocked; fixtures are
 * deleted after each test.
 */
import {
  type SaveCompetitorFeedInput,
  SOKO_BOT_TOOL_DESCRIPTIONS,
} from "@sokosumi/soko-bot";
import { readCmoCompetitorWeek } from "@sokosumi/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  evaluateWithJev: vi.fn(),
  requestCmoStrategy: vi.fn(),
  startCmoTurn: vi.fn(),
}));
vi.mock("@/lib/soko-bot/jev", async (original) => ({
  ...(await original<typeof import("@/lib/soko-bot/jev")>()),
  evaluateWithJev: mocks.evaluateWithJev,
}));
vi.mock("@/services/cmo-strategy.service", () => ({
  requestCmoStrategy: mocks.requestCmoStrategy,
}));
vi.mock("@/services/cmo-cuso.service", async (original) => ({
  ...(await original<typeof import("@/services/cmo-cuso.service")>()),
  startCmoTurn: mocks.startCmoTurn,
}));

import prisma from "@/lib/db/prisma";
import {
  addCompetitorMoveToStrategy,
  saveCusoCompetitorFeed,
  startCompetitorWatchRun,
} from "@/services/cmo-competitors.service";
import {
  latestCompetitorFeed,
  readCompetitorSignals,
  recentCompetitorMoves,
} from "@/services/competitor-feed.service";
import {
  addTrackedCompetitor,
  listTrackedCompetitors,
} from "@/services/competitors.service";
import { expectCoreLog } from "@/test/core-log";
import {
  deleteSeededCusos,
  type Seeded,
  seedCuso,
} from "@/test-fixtures/cmo-competitors-db";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const NOW = new Date("2026-11-16T10:00:00Z");

interface World {
  cuso: Seeded;
  calendly: string;
  zcal: string;
  price: string;
  news: string;
  social: string;
}

async function world(): Promise<World> {
  const cuso = await seedCuso();
  const room = await prisma.chatRoom.create({
    data: {
      organizationId: cuso.organizationId,
      name: "Cuso",
      // As `createSharedSokoBot` makes it: a public channel needs a slug.
      slug: `cuso-${cuso.sokoBotId}`,
      discoverability: "public",
      createdByUserId: cuso.userId,
    },
    select: { id: true },
  });
  await prisma.sokoBot.update({
    where: { id: cuso.sokoBotId },
    data: { sharedRoomId: room.id },
  });
  await addTrackedCompetitor(cuso.projectId, { name: "Calendly" });
  await addTrackedCompetitor(cuso.projectId, { name: "Zcal" });
  const [calendly, zcal] = await listTrackedCompetitors(cuso.projectId);
  if (!calendly || !zcal) throw new Error("not seeded");
  await prisma.competitorCheck.create({
    data: {
      projectId: cuso.projectId,
      day: "2026-11-16",
      createdAt: new Date("2026-11-16T09:00:00Z"),
      finishedAt: new Date("2026-11-16T09:01:00Z"),
      sources: {
        pages: { status: "ok" },
        news: { status: "ok" },
        ads: { status: "not_configured" },
        social: { status: "ok" },
      },
    },
  });
  const signal = (data: {
    competitorId: string;
    kind: "PRICE_CHANGE" | "NEWS" | "SOCIAL";
    summary: string;
    quote: string | null;
    dedupeKey: string;
    raw?: object;
  }) =>
    prisma.competitorSignal.create({
      data: {
        projectId: cuso.projectId,
        observedAt: new Date("2026-11-15T12:00:00Z"),
        createdAt: new Date("2026-11-16T09:00:30Z"),
        sourceUrl: "https://example.com/source",
        sourceTitle: "Source",
        sourcePublisher: "example.com",
        raw: data.raw ?? {},
        ...data,
      },
      select: { id: true },
    });
  const price = await signal({
    competitorId: calendly.id,
    kind: "PRICE_CHANGE",
    summary: "Standard plan $10 -> $12 per seat",
    quote: "$12 per seat/month",
    dedupeKey: "page:PRICING:2026-11-16",
    raw: { prices: { before: ["$10"], after: ["$12"] } },
  });
  const news = await signal({
    competitorId: zcal.id,
    kind: "NEWS",
    summary: "Zcal added team pages",
    quote: "Zcal now lets teams share one booking page.",
    dedupeKey: "news:zcal-team-pages",
  });
  const social = await signal({
    competitorId: calendly.id,
    kind: "SOCIAL",
    summary: "3 Instagram posts this week, 41,000 followers",
    quote: null,
    dedupeKey: "instagram:2026-11-16",
  });
  return {
    cuso,
    calendly: calendly.id,
    zcal: zcal.id,
    price: price.id,
    news: news.id,
    social: social.id,
  };
}

function priceFeed(w: World, text: string): SaveCompetitorFeedInput {
  return {
    items: [
      {
        competitorId: w.calendly,
        facts: [{ text, signalIds: [w.price], support: "strong" }],
        meaning:
          "Calendly's price rise makes our Teams plan the cheaper one for small teams.",
        move: "Lead the pricing page with the price per seat next week.",
      },
    ],
    openQuestions: [],
  };
}

function jevSays(probability: number) {
  mocks.evaluateWithJev.mockImplementation(
    async ({ questions }: { questions: Record<string, unknown> }) => ({
      answers: new Map(
        Object.keys(questions).map((key) => [
          key,
          { type: "boolean", probability },
        ]),
      ),
      costUsd: 0.002,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  jevSays(0.95);
});

afterEach(async () => {
  if (enabled) await deleteSeededCusos();
});

// The first test also pays for the cold imports and the first connection.
describe.skipIf(!enabled)(
  "competitor feed (PostgreSQL)",
  { timeout: 20_000 },
  () => {
    it("gives Cuso the check's signals with their sources", async () => {
      const w = await world();
      const read = await readCompetitorSignals(w.cuso.projectId, NOW);
      expect(read.signals.map((signal) => signal.summary).sort()).toEqual([
        "3 Instagram posts this week, 41,000 followers",
        "Standard plan $10 -> $12 per seat",
        "Zcal added team pages",
      ]);
      expect(read.signals.find((s) => s.kind === "PRICE_CHANGE")).toMatchObject(
        {
          big: true,
          competitor: "Calendly",
          date: "2026-11-15",
          source: { title: "Source", publisher: "example.com" },
          quote: "$12 per seat/month",
        },
      );
      expect(read.unreadable).toEqual([
        { source: "ads", status: "not_configured" },
      ]);
      // The tool's description names the field this result really has.
      expect(SOKO_BOT_TOOL_DESCRIPTIONS.check_competitors).toContain(
        "unreadable lists the sources",
      );
      expect(SOKO_BOT_TOOL_DESCRIPTIONS.check_competitors).not.toContain(
        "sources says",
      );
    });

    it("saves the week's moves and names the big ones", async () => {
      const w = await world();
      const saved = await saveCusoCompetitorFeed({
        projectId: w.cuso.projectId,
        sokoBotId: w.cuso.sokoBotId,
        turnId: null,
        feed: priceFeed(
          w,
          "Calendly raised Standard from $10 to $12 per seat.",
        ),
        now: NOW,
      });
      expect(saved).toMatchObject({
        saved: 1,
        bigMoves: [
          {
            competitor: "Calendly",
            fact: "Calendly raised Standard from $10 to $12 per seat.",
          },
        ],
        costUsd: 0.002,
      });
      const feed = await latestCompetitorFeed(w.cuso.projectId);
      expect(feed).toMatchObject({ checkDay: "2026-11-16", openQuestions: [] });
      expect(feed?.items[0]).toMatchObject({
        big: true,
        competitorId: w.calendly,
      });
    });

    it("puts a price change before a launch and the rest", async () => {
      const w = await world();
      await saveCusoCompetitorFeed({
        projectId: w.cuso.projectId,
        sokoBotId: w.cuso.sokoBotId,
        turnId: null,
        feed: {
          items: [
            {
              competitorId: w.zcal,
              facts: [
                {
                  text: "Zcal added team pages.",
                  signalIds: [w.news],
                  support: "strong",
                },
              ],
              meaning: "Teams can compare our booking pages with Zcal's.",
              move: "Put our team page on the homepage on Tuesday.",
            },
            ...priceFeed(
              w,
              "Calendly raised Standard from $10 to $12 per seat.",
            ).items,
          ],
          openQuestions: [],
        },
        now: NOW,
      });
      const feed = await latestCompetitorFeed(w.cuso.projectId);
      expect(feed?.items.map((item) => [item.competitorId, item.big])).toEqual([
        [w.calendly, true],
        [w.zcal, false],
      ]);
    });

    it("posts the week to Cuso's room as one message, and rewrites it on a second save", async () => {
      const w = await world();
      const zcal = {
        competitorId: w.zcal,
        facts: [
          {
            text: "Zcal added team pages.",
            signalIds: [w.news],
            support: "weak" as const,
          },
        ],
        meaning: "Zcal's team pages give teams a second booking page.",
        move: "Put our team page on the homepage on Tuesday.",
      };
      const save = (text: string) =>
        saveCusoCompetitorFeed({
          projectId: w.cuso.projectId,
          sokoBotId: w.cuso.sokoBotId,
          turnId: null,
          feed: {
            items: [zcal, ...priceFeed(w, text).items],
            openQuestions: [],
          },
          now: NOW,
        });
      await save("Calendly raised Standard from $10 to $12.");
      await save("Calendly raised Standard from $10 to $12 per seat.");
      const messages = await prisma.chatRoomMessage.findMany({
        where: { senderSokoBotId: w.cuso.sokoBotId },
        select: { content: true, clientMessageId: true, metadata: true },
      });
      expect(messages).toHaveLength(1);
      expect(messages[0]?.clientMessageId).toBe(
        "cmo:competitor-week:2026-11-16",
      );
      expect(messages[0]?.content).toBe(
        [
          "**What your competitors did this week**",
          [
            "- Calendly raised Standard from $10 to $12 per seat. ([example.com](https://example.com/source))",
            "  - What this means for you: Calendly's price rise makes our Teams plan the cheaper one for small teams.",
            "  - Suggested move: Lead the pricing page with the price per seat next week.",
            "- Zcal added team pages. ([example.com](https://example.com/source))",
          ].join("\n"),
          "Every move, with what it means for you and what to do about it, is on the Competitors tab.",
        ].join("\n\n"),
      );
      // Nothing of the scrape (the source's quote) or of how well it is
      // backed reaches the chat; the Competitors tab keeps both.
      expect(messages[0]?.content).not.toMatch(/\$12 per seat\/month|in part/);
      expect(readCmoCompetitorWeek(messages[0]?.metadata)).toEqual({
        checkDay: "2026-11-16",
        moves: [
          {
            competitor: "Calendly",
            text: "Calendly raised Standard from $10 to $12 per seat.",
            source: {
              label: "example.com",
              url: "https://example.com/source",
            },
            big: true,
            meaning:
              "Calendly's price rise makes our Teams plan the cheaper one for small teams.",
            move: "Lead the pricing page with the price per seat next week.",
          },
          {
            competitor: "Zcal",
            text: "Zcal added team pages.",
            source: {
              label: "example.com",
              url: "https://example.com/source",
            },
            big: false,
          },
        ],
      });
    });

    it("refuses a meaning that fits any move and a post on a network that is not connected", async () => {
      const w = await world();
      const feed = priceFeed(w, "Calendly raised Standard from $10 to $12.");
      const [item] = feed.items;
      if (!item) throw new Error("no item");
      item.meaning = "The strategy's posts can explain pricing to teams.";
      item.move = "Post on LinkedIn on Tuesday: the price per seat.";

      await expect(
        saveCusoCompetitorFeed({
          projectId: w.cuso.projectId,
          sokoBotId: w.cuso.sokoBotId,
          turnId: null,
          feed,
          now: NOW,
        }),
      ).rejects.toThrow(
        /would fit any move[\s\S]*LinkedIn, which is not connected/,
      );
      expect(
        await prisma.competitorFeed.count({
          where: { projectId: w.cuso.projectId },
        }),
      ).toBe(0);
    });

    it("calls nothing out in a week without big moves", async () => {
      const w = await world();
      await saveCusoCompetitorFeed({
        projectId: w.cuso.projectId,
        sokoBotId: w.cuso.sokoBotId,
        turnId: null,
        feed: {
          items: [
            {
              competitorId: w.zcal,
              facts: [
                {
                  text: "Zcal added team pages.",
                  signalIds: [w.news],
                  support: "weak",
                },
              ],
              meaning:
                "Zcal's team pages give teams a second booking page to compare.",
              move: "Put our team page on the homepage on Tuesday.",
            },
          ],
          openQuestions: [],
        },
        now: NOW,
      });
      const [message] = await prisma.chatRoomMessage.findMany({
        where: { senderSokoBotId: w.cuso.sokoBotId },
        select: { content: true },
      });
      expect(message?.content).toContain("- Zcal added team pages.");
      expect(message?.content).not.toContain("Suggested move");
    });

    it("refuses the whole feed when one fact rests on nothing", async () => {
      const w = await world();
      const feed = priceFeed(
        w,
        "Calendly raised Standard from $10 to $12 per seat and lost 20% of teams.",
      );
      await expect(
        saveCusoCompetitorFeed({
          projectId: w.cuso.projectId,
          sokoBotId: w.cuso.sokoBotId,
          turnId: null,
          feed,
          now: NOW,
        }),
      ).rejects.toThrow("has 20, which its signals do not say");
      expect(mocks.evaluateWithJev).not.toHaveBeenCalled();
      expect(await latestCompetitorFeed(w.cuso.projectId)).toBeNull();
    });

    it("refuses a fact Jev finds its sources do not say", async () => {
      const w = await world();
      jevSays(0.1);
      await expect(
        saveCusoCompetitorFeed({
          projectId: w.cuso.projectId,
          sokoBotId: w.cuso.sokoBotId,
          turnId: null,
          feed: priceFeed(w, "Calendly is raising prices to fund its AI push."),
          now: NOW,
        }),
      ).rejects.toThrow("is not what its signals say");
    });

    it("refuses, and saves nothing, when Jev cannot answer", async () => {
      const w = await world();
      mocks.evaluateWithJev.mockRejectedValue(new Error("gateway down"));
      await expect(
        saveCusoCompetitorFeed({
          projectId: w.cuso.projectId,
          sokoBotId: w.cuso.sokoBotId,
          turnId: null,
          feed: priceFeed(w, "Calendly raised Standard from $10 to $12."),
          now: NOW,
        }),
      ).rejects.toThrow("could not be checked just now");
      expectCoreLog("warn", "Could not check a competitor feed");
      expect(await latestCompetitorFeed(w.cuso.projectId)).toBeNull();
    });

    it("saves a quiet week as its open questions", async () => {
      const w = await world();
      const saved = await saveCusoCompetitorFeed({
        projectId: w.cuso.projectId,
        sokoBotId: w.cuso.sokoBotId,
        turnId: null,
        feed: {
          items: [],
          openQuestions: ["Is Zcal's team page free or paid? No source says."],
        },
        now: NOW,
      });
      expect(saved).toMatchObject({ saved: 0, bigMoves: [], costUsd: 0 });
      expect(
        await prisma.chatRoomMessage.count({
          where: { senderSokoBotId: w.cuso.sokoBotId },
        }),
      ).toBe(0);
      expect(await latestCompetitorFeed(w.cuso.projectId)).toMatchObject({
        items: [],
        openQuestions: ["Is Zcal's team page free or paid? No source says."],
      });
    });

    it("sends a move to the strategy once, through the patch path", async () => {
      const w = await world();
      await saveCusoCompetitorFeed({
        projectId: w.cuso.projectId,
        sokoBotId: w.cuso.sokoBotId,
        turnId: null,
        feed: priceFeed(
          w,
          "Calendly raised Standard from $10 to $12 per seat.",
        ),
        now: NOW,
      });
      const [item] =
        (await latestCompetitorFeed(w.cuso.projectId))?.items ?? [];
      if (!item) throw new Error("not saved");
      mocks.requestCmoStrategy.mockResolvedValue({ turnId: "turn-1" });
      await addCompetitorMoveToStrategy(w.cuso, item.id);
      expect(mocks.requestCmoStrategy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: w.cuso.userId,
          projectId: w.cuso.projectId,
          patch: true,
          note: expect.stringContaining(
            "Move to add: Lead the pricing page with the price per seat next week.",
          ),
        }),
      );
      await expect(
        addCompetitorMoveToStrategy(w.cuso, item.id),
      ).rejects.toThrow("already in the strategy");
      // Cuso rewriting the week keeps the move marked as added.
      await saveCusoCompetitorFeed({
        projectId: w.cuso.projectId,
        sokoBotId: w.cuso.sokoBotId,
        turnId: null,
        feed: priceFeed(
          w,
          "Calendly raised Standard from $10 to $12 per seat.",
        ),
        now: NOW,
      });
      const [kept] =
        (await latestCompetitorFeed(w.cuso.projectId))?.items ?? [];
      expect(kept).toMatchObject({
        id: item.id,
        addedToStrategyAt: expect.any(String),
      });
      expect(await recentCompetitorMoves(w.cuso.projectId, NOW)).toEqual([
        {
          checkedOn: "2026-11-16",
          competitor: "Calendly",
          happened: "Calendly raised Standard from $10 to $12 per seat.",
          meaning:
            "Calendly's price rise makes our Teams plan the cheaper one for small teams.",
          move: "Lead the pricing page with the price per seat next week.",
        },
      ]);
    });

    it("starts the watch run once per check, as Cuso's runner", async () => {
      const w = await world();
      const cuso = {
        ...w.cuso,
        workspaceId: (
          await prisma.project.findUniqueOrThrow({
            where: { id: w.cuso.projectId },
            select: { workspaceId: true },
          })
        ).workspaceId,
      };
      mocks.startCmoTurn.mockResolvedValue({ turnId: "turn-1" });
      await startCompetitorWatchRun(cuso, "check-1");
      expect(mocks.startCmoTurn).toHaveBeenCalledWith(
        expect.objectContaining({ sokoBotId: w.cuso.sokoBotId }),
        w.cuso.userId,
        expect.objectContaining({
          clientTurnId: "cmo:competitors:check-1",
          message: expect.stringContaining("Calendly, Zcal"),
        }),
      );
    });
  },
);
