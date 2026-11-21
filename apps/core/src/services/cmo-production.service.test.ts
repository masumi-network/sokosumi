import type {
  CmoCalendarEntry,
  MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import { waitUntil } from "@vercel/functions";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { coreEvlogMiddleware, recordCoreWarning } from "@/lib/evlog";
import { findCusoForBot } from "@/services/cmo-cuso.service";

import type { MarketingStrategyPost } from "@/services/marketing-strategy.service";
import {
  coreLogEvents,
  expectCoreLog,
  expectCoreLogWhys,
} from "@/test/core-log";

const {
  turnFindMany,
  turnFindFirst,
  botFindUniqueOrThrow,
  botFindUnique,
  startTurn,
  isCmoSubscribed,
  listCmoChannels,
  cmoRunnerUserId,
  listCusos,
  scheduleUpdateMany,
  approvedStrategy,
  listPosts,
  listFiles,
  advanceCmoMonthReview,
  getBrandBrain,
  listMediaJobs,
  advanceMedia,
  turnCount,
  subscriptionFindFirst,
} = vi.hoisted(() => ({
  listMediaJobs: vi.fn(),
  advanceMedia: vi.fn(),
  turnCount: vi.fn(),
  advanceCmoMonthReview: vi.fn(),
  getBrandBrain: vi.fn(),
  approvedStrategy: vi.fn(),
  listPosts: vi.fn(),
  listFiles: vi.fn(),
  cmoRunnerUserId: vi.fn(),
  listCusos: vi.fn(),
  scheduleUpdateMany: vi.fn(),
  turnFindMany: vi.fn(),
  turnFindFirst: vi.fn(),
  botFindUniqueOrThrow: vi.fn(),
  botFindUnique: vi.fn(),
  startTurn: vi.fn(),
  isCmoSubscribed: vi.fn(),
  listCmoChannels: vi.fn(),
  subscriptionFindFirst: vi.fn(),
}));

// PostgreSQL's clock: the test clock, or the time a test sets.
const pgClock = vi.hoisted(() => ({ now: null as Date | null }));
vi.mock("@/lib/db/database-now", () => ({
  databaseNow: async () => pgClock.now ?? new Date(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotSchedule: { updateMany: scheduleUpdateMany },
    sokoBotTurn: {
      findMany: turnFindMany,
      findFirst: turnFindFirst,
      count: turnCount,
    },
    sokoBot: {
      findUniqueOrThrow: botFindUniqueOrThrow,
      findUnique: botFindUnique,
    },
    polarSubscription: { findFirst: subscriptionFindFirst },
  },
}));

vi.mock("@/services/cmo-cuso.service", () => ({
  findCusoForBot: vi.fn(),
  listCusosWithApprovedStrategy: listCusos,
  cmoRunnerUserId,
  listCmoChannels,
}));
vi.mock("@/services/cmo-billing.service", async () => {
  const { cmoVolumeLevelForTier } = await import("@sokosumi/utils");
  return {
    isCmoSubscribed,
    cmoPlanLevel: async () =>
      cmoVolumeLevelForTier((await subscriptionFindFirst())?.tier ?? null),
  };
});
const keepCusoFirstCompetitorCheck = vi.hoisted(() => vi.fn());
vi.mock("@/services/cmo-competitors.service", () => ({
  keepCusoFirstCompetitorCheck,
}));
vi.mock("@/services/marketing-strategy.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/marketing-strategy.service")
  >()),
  approvedMarketingStrategy: approvedStrategy,
  listMarketingStrategyPosts: listPosts,
  listMarketingStrategyFiles: listFiles,
}));

vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { startTurn, reconcileTurn: vi.fn() },
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/services/cmo-month-review.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/cmo-month-review.service")
  >()),
  advanceCmoMonthReview,
}));
vi.mock("@/services/cmo-media-maker.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/cmo-media-maker.service")
  >()),
  listCmoMediaJobs: listMediaJobs,
  advanceCmoMedia: advanceMedia,
}));
vi.mock("@/services/brand-brain.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/brand-brain.service")>()),
  getBrandBrain,
}));

import {
  advanceCmoProduction,
  type CmoPiece,
  cmoHiredAt,
  cmoMixLedger,
  cmoPieceReady,
  cmoPraiseOnly,
  cmoProductionMessage,
  cmoProductionSteps,
  cmoReadyPieceIds,
  cmoSyncOrder,
  kickCmoProduction,
  readCmoProduction,
  syncCmoProduction,
} from "./cmo-production.service";

const NOW = new Date("2026-11-02T08:00:00Z");
const APPROVED = Date.parse("2026-11-01T09:00:00Z");
const RUN = `cmo:production:bot-1:${APPROVED}`;

function entry(patch: Partial<CmoCalendarEntry>): CmoCalendarEntry {
  return {
    id: "e1",
    date: "2026-11-05",
    time: "09:00",
    channel: "linkedin",
    format: "text",
    title: "Setup in ten minutes",
    status: "idea",
    approach: "educational",
    ...patch,
  } as CmoCalendarEntry;
}

function piece(
  patch: Partial<CmoCalendarEntry>,
  media: string[] = [],
): CmoPiece {
  return { ...entry(patch), media };
}

/** The approved version's Social post, as the strategy's posts read it. */
function post(
  patch: Partial<CmoCalendarEntry>,
  media: string[] = [],
): MarketingStrategyPost {
  const made = entry(patch);
  return {
    entry: { ...made, socialPostId: made.id },
    entryId: made.id,
    revision: 1,
    media: media.map((pathname) => ({
      pathname,
      fileUrl: `https://blob.example/${pathname}`,
      name: pathname,
      size: 1,
      mimeType: "image/png",
      kind: "image" as const,
    })),
  };
}

function strategy(calendar: CmoCalendarEntry[]): MarketingStrategyPlan {
  return {
    month: "2026-11",
    summary: "Seed recipe videos, then the first-order offer.",
    goals: ["More first orders"],
    pillars: ["Recipes"],
    channels: [{ channel: "linkedin", cadence: "3 a week" }],
    mix: [
      { approach: "educational", share: 60, why: "Teach quick dinners" },
      { approach: "promotional", share: 40, why: "The first-order offer" },
    ],
    calendar,
    previews: [],
    changes: [],
  } as unknown as MarketingStrategyPlan;
}

/** Production turns of Cuso's bot, newest first, as the runs query reads them. */
type Run = {
  clientTurnId: string;
  status: string;
  createdAt: Date;
  completedAt?: Date | null;
};

/**
 * A hire whose Project's approved version became these Social posts, and
 * whose plan holds these other pieces with the files written so far.
 */
function cuso(
  posts: MarketingStrategyPost[],
  runs: Run[] = [],
  other: {
    calendar?: CmoCalendarEntry[];
    files?: Map<string, { fileId: string; media: string[] }>;
  } = {},
) {
  approvedStrategy.mockResolvedValue({
    id: "strategy-1",
    projectId: "project-1",
    plan: strategy(other.calendar ?? []),
    approvedAt: new Date(APPROVED),
  });
  listPosts.mockResolvedValue(posts);
  listFiles.mockResolvedValue(other.files ?? new Map());
  turnFindMany.mockResolvedValue(
    runs.map((run) => ({ completedAt: null, ...run })),
  );
  return {
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    projectId: "project-1",
    businessName: "Acme",
  } as never;
}

const hoursAgo = (hours: number) =>
  new Date(NOW.getTime() - hours * 60 * 60 * 1_000);

describe("cmoHiredAt", () => {
  it("keeps the first approval after a later one replaced it", async () => {
    turnFindFirst.mockResolvedValueOnce({ clientTurnId: `${RUN}:1:0` });
    const later = new Date("2026-11-08T09:00:00Z");
    expect(await cmoHiredAt("bot-1", later)).toEqual(new Date(APPROVED));
  });

  it("falls back to the approval before production started", async () => {
    turnFindFirst.mockResolvedValueOnce(null);
    expect(await cmoHiredAt("bot-1", new Date(APPROVED))).toEqual(
      new Date(APPROVED),
    );
    turnFindFirst.mockResolvedValueOnce(null);
    expect(await cmoHiredAt("bot-1", null)).toBeNull();
  });
});

describe("cmoPieceReady", () => {
  const connected = new Set(["instagram"]);

  it("needs the words, the picture its format has, and a schedule on a connected network", () => {
    expect(cmoPieceReady(piece({}), connected)).toBe(false);
    expect(cmoPieceReady(piece({ draft: "Ready to post." }), connected)).toBe(
      true,
    );
    const image = { channel: "linkedin", format: "image", draft: "Words" };
    expect(cmoPieceReady(piece(image), connected)).toBe(false);
    expect(cmoPieceReady(piece(image, ["drive/a.png"]), connected)).toBe(true);
    const instagram = {
      channel: "instagram",
      format: "image",
      draft: "Words",
    };
    // A connected network's piece waits until it is scheduled.
    expect(cmoPieceReady(piece(instagram, ["drive/a.png"]), connected)).toBe(
      false,
    );
    expect(
      cmoPieceReady(
        piece({ ...instagram, status: "scheduled" }, ["drive/a.png"]),
        connected,
      ),
    ).toBe(true);
  });

  it("counts a TikTok video as made once it has its words and video: it waits for the owner, not for Cuso", () => {
    const tiktok = { channel: "tiktok", format: "video", draft: "Words" };
    const withTikTok = new Set(["tiktok"]);
    expect(cmoPieceReady(piece(tiktok), withTikTok)).toBe(false);
    expect(cmoPieceReady(piece(tiktok, ["drive/a.mp4"]), withTikTok)).toBe(
      true,
    );
  });

  it("counts published and skipped pieces as done", () => {
    expect(cmoPieceReady(piece({ status: "published" }), connected)).toBe(true);
    expect(cmoPieceReady(piece({ status: "skipped" }), connected)).toBe(true);
  });
});

describe("a piece kept in the Project's Files", () => {
  it("is made once its file is written, and an ad also needs its picture", () => {
    const article = piece({ channel: "seo", format: "article" });
    expect(cmoPieceReady(article, new Set())).toBe(false);
    expect(cmoPieceReady({ ...article, fileId: "file-1" }, new Set())).toBe(
      true,
    );
    const ad = piece({ channel: "meta_ads", format: "image_ad", fileId: "f" });
    expect(cmoPieceReady(ad, new Set())).toBe(false);
    expect(cmoPieceReady({ ...ad, media: ["image-1"] }, new Set())).toBe(true);
  });

  it("is counted with the month and briefed to be saved as a file", async () => {
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy([]),
      pending: [
        piece({ id: "seo-1", channel: "seo", format: "article" }),
        piece({ id: "x-1", channel: "x", format: "post" }),
      ],
      connected: new Set(),
      attempt: 1,
      topUp: false,
    });
    expect(message).toContain(
      "(Project file: save its words with save_strategy part pieces)",
    );
    expect(message).toContain("Core writes the file");
    expect(message).toContain("update_social_post");
  });
});

describe("cmoProductionSteps", () => {
  it("counts the words pass and the pictures pass apart", () => {
    const image = { format: "image" };
    expect(
      cmoProductionSteps([
        piece({ id: "a", draft: "Words" }),
        piece({ ...image, id: "b", draft: "Words" }),
        piece({ ...image, id: "c", draft: "Words" }, ["drive/1.png"]),
        piece({ ...image, id: "d" }, ["drive/1.png"]),
        piece({ id: "e", status: "published" }),
      ]),
    ).toEqual({ written: 4, pictured: 1, needPictures: 3 });
  });
});

describe("cmoReadyPieceIds", () => {
  it("counts a picture for the first piece that uses it, not a second", () => {
    const image = { format: "image", draft: "Words" };
    const ready = cmoReadyPieceIds(
      [
        piece({ ...image, id: "a" }, ["drive/1.png"]),
        piece({ ...image, id: "b" }, ["drive/1.png"]),
        piece({ ...image, id: "c" }, ["drive/2.png"]),
        piece({ id: "d", draft: "Text only" }),
      ],
      new Set(),
    );
    expect([...ready]).toEqual(["a", "c", "d"]);
  });

  it("finishes every post of one talking video, which share its file", () => {
    const talking = { format: "talking_video", draft: "Caption" };
    const pieces = [
      piece({ ...talking, id: "reel", channel: "instagram" }, ["drive/v.mp4"]),
      piece({ ...talking, id: "short", channel: "youtube", videoOf: "tv" }, [
        "drive/v.mp4",
      ]),
    ];
    expect([...cmoReadyPieceIds(pieces, new Set())]).toEqual(["reel", "short"]);
    expect(cmoProductionSteps(pieces)).toMatchObject({
      pictured: 2,
      needPictures: 2,
    });
  });

  it("finishes a carousel only with its slides, none shared with another piece", () => {
    const carousel = {
      channel: "instagram",
      format: "carousel",
      draft: "Swipe for three fits",
    };
    const ready = cmoReadyPieceIds(
      [
        piece({ ...carousel, id: "two" }, ["s1", "s2"]),
        piece({ ...carousel, id: "three" }, ["s1", "s2", "s3"]),
        piece({ ...carousel, id: "shared" }, ["t1", "t2", "s3"]),
        piece(
          {
            id: "single",
            channel: "instagram",
            format: "image",
            draft: "One picture",
          },
          ["s2"],
        ),
      ],
      new Set(),
    );
    expect([...ready]).toEqual(["three"]);
  });
});

describe("cmoProductionMessage", () => {
  it("lists every piece by its Social post with its approach, and the mix as the calendar holds it", () => {
    const calendar = [
      entry({ id: "a", approach: "educational" }),
      entry({ id: "b", approach: "promotional", channel: "x" }),
    ];
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy(calendar),
      pending: calendar.map((item) => piece(item)),
      connected: new Set(["x"]),
      attempt: 1,
      topUp: false,
    });
    expect(message).toContain("- a · 2026-11-05 09:00 · linkedin/text");
    expect(message).toContain("Connected networks: x");
    expect(message).toContain("update_social_post");
    expect(message).toContain("educational 1 of 2 (planned 60%)");
    expect(message).toContain("report_update kind production");
    expect(message).toContain("DONE:");
    expect(cmoMixLedger(strategy(calendar))).toBe(
      "educational 1 of 2 (planned 60%), promotional 1 of 2 (planned 40%)",
    );
  });

  it("asks for a style on every picture, slides included, only where the reference library is set up", () => {
    const withPicture = [entry({ id: "a", format: "image" })];
    const input = {
      businessName: "Acme",
      strategy: strategy(withPicture),
      pending: withPicture.map((item) => piece(item)),
      connected: new Set<string>(),
      attempt: 1,
      topUp: false,
    };
    const brief = cmoProductionMessage({ ...input, styles: true });
    expect(brief).toContain("every piece with a picture takes the look");
    expect(brief).toContain("send visualFileIds as an empty list");
    expect(cmoProductionMessage(input)).not.toContain("find_style_references");
    const carousel = [
      entry({ id: "c", channel: "instagram", format: "carousel" }),
    ];
    expect(
      cmoProductionMessage({
        ...input,
        strategy: strategy(carousel),
        pending: carousel.map((item) => piece(item)),
        styles: true,
      }),
    ).toContain("slideHeadlines: one entry per slide");
    // Text has no picture, and a video is animated from a plain still.
    for (const patch of [
      { id: "b" },
      { id: "v", channel: "tiktok", format: "video" },
    ]) {
      const other = [entry(patch)];
      expect(
        cmoProductionMessage({
          ...input,
          strategy: strategy(other),
          pending: other.map((item) => piece(item)),
          styles: true,
        }),
      ).not.toContain("find_style_references");
    }
  });

  it("makes the whole month from a short plan: titled weeks like week one", () => {
    // The first plan writes week one in full and weeks two to four as titles.
    const calendar = Array.from({ length: 16 }, (_, index) =>
      entry({
        id: `e${index + 1}`,
        date: `2026-11-${String(5 + index).padStart(2, "0")}`,
        title: `Piece ${index + 1}`,
        ...(index < 4 ? { brief: `What piece ${index + 1} shows.` } : {}),
      }),
    );
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy(calendar),
      pending: calendar.map((item) => piece(item)),
      connected: new Set(),
      attempt: 1,
      topUp: false,
    });

    expect(message).toContain("Pieces (16):");
    for (const item of calendar) expect(message).toContain(`- ${item.id} ·`);
    expect(message).toContain("brief: What piece 1 shows.");
    expect(message).toContain(
      '"Piece 16" · (no brief: write it from its title, approach and pillar)',
    );
  });

  it("tells a top-up run the month is already made", () => {
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy([entry({})]),
      pending: [piece({})],
      connected: new Set(),
      attempt: 3,
      topUp: true,
    });
    expect(message).toContain("The month is made.");
    expect(message).toContain("Connected networks: none yet");
  });

  it("asks a talking video for its script, and its posts on other networks for a caption only", () => {
    const talking = { channel: "instagram", format: "talking_video" };
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy([]),
      pending: [
        piece({ ...talking, id: "tv" }),
        piece({
          ...talking,
          id: "written",
          script: "Stop emailing back and forth.",
        }),
        piece({ ...talking, id: "yt", channel: "youtube", videoOf: "tv" }),
      ],
      connected: new Set(),
      attempt: 1,
      topUp: false,
    });
    expect(message).toContain("(write its script)");
    expect(message).toContain(
      "(the talking video of tv on youtube: write only this post's own caption for youtube; its script stays on tv)",
    );
    expect(message).not.toContain("(write its visual)");
  });

  it("asks for a visual and names the proof, and leaves the media to Core", () => {
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy([]),
      pending: [
        piece({ id: "c", channel: "instagram", format: "carousel" }),
        piece({ id: "x", channel: "x", format: "image", visual: "A shoe" }),
      ],
      connected: new Set(),
      attempt: 1,
      topUp: true,
      proof: ["Book.io sold 130,000+ NFTs across 70+ titles."],
      failedMedia: new Set(["x"]),
    });
    expect(message).toContain(
      "carousel of 3 slides: one visual and a line per slide in slides, Core makes each slide · (write its visual)",
    );
    expect(message).toContain(
      "(its picture failed twice: write a different visual)",
    );
    expect(message).toContain(
      "- Book.io sold 130,000+ NFTs across 70+ titles.",
    );
    expect(message).toContain("never call generate_image or generate_video");
  });

  it("fits a full batch on every network in one background turn", () => {
    const channels = [
      ["x", "post"],
      ["linkedin", "text"],
      ["instagram", "carousel"],
      ["facebook", "post"],
      ["tiktok", "video"],
      ["youtube", "short"],
      ["seo", "article"],
      ["newsletter", "issue"],
      ["google_ads", "search"],
      ["meta_ads", "image"],
    ];
    const calendar = Array.from({ length: 60 }, (_, index) => {
      const [channel, format] = channels[index % channels.length] ?? [];
      return entry({
        id: `piece-${index}`,
        channel,
        format,
        title: "A useful report without a visitor profile behind it",
        brief:
          "Show one real report and the decision it settles, in the brand's own words.",
      } as Partial<CmoCalendarEntry>);
    });
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy(calendar),
      pending: calendar.map((item) => piece(item)),
      connected: new Set(),
      attempt: 1,
      topUp: false,
    });
    // Over a chat message's 20,000 characters, under a background turn's cap.
    expect(message.length).toBeGreaterThan(20_000);
    expect(message.length).toBeLessThan(100_000);
  });

  it("hands the run the writing skills of the batch's channels only", () => {
    const calendar = [
      entry({ id: "a" }),
      entry({ id: "b", channel: "x", format: "post" }),
    ];
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy(calendar),
      pending: calendar.map((item) => piece(item)),
      connected: new Set(),
      attempt: 1,
      topUp: false,
    });
    for (const id of [
      "brand-voice",
      "post-formatting",
      "hooks-and-endings",
      "linkedin",
      "x",
    ])
      expect(message).toContain(`<skill id="${id}">`);
    expect(message).not.toContain('<skill id="instagram">');
    expect(message).not.toContain('<skill id="newsletter">');
    expect(message.indexOf('<skill id="brand-voice">')).toBeLessThan(
      message.indexOf('<skill id="linkedin">'),
    );
  });
});

describe("advanceCmoProduction", () => {
  beforeEach(() => {
    pgClock.now = null;
    vi.clearAllMocks();
    isCmoSubscribed.mockResolvedValue(true);
    listCmoChannels.mockResolvedValue([]);
    turnFindFirst.mockResolvedValue({ id: "turn-0" });
    botFindUniqueOrThrow.mockResolvedValue({ sharedRoomId: "room-1" });
    botFindUnique.mockResolvedValue({ versionId: "cmo-v5" });
    cmoRunnerUserId.mockResolvedValue("user-1");
    startTurn.mockResolvedValue({ turnId: "run-1", status: "QUEUED" });
    listMediaJobs.mockResolvedValue([]);
    advanceMedia.mockResolvedValue(undefined);
    turnCount.mockResolvedValue(0);
  });

  it("waits until the plan is approved and paid for", async () => {
    isCmoSubscribed.mockResolvedValue(false);
    const result = await advanceCmoProduction(cuso([post({})]), NOW);
    expect(result.state).toBe("waiting");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("never makes a draft: no approved version, no run", async () => {
    const draftOnly = cuso([post({})]);
    approvedStrategy.mockResolvedValue(null);
    const result = await advanceCmoProduction(draftOnly, NOW);
    expect(result.state).toBe("waiting");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts one background run for the month's Social posts, under Cuso's newest turn", async () => {
    const result = await advanceCmoProduction(
      cuso([post({ id: "a" }), post({ id: "b" })]),
      NOW,
    );
    expect(result).toMatchObject({ state: "running", ready: 0, total: 2 });
    const started = startTurn.mock.calls[0]?.[0];
    // In Cuso's shared room, spent as his runner (ADR 0061).
    expect(started).toMatchObject({
      userId: "user-1",
      sokoBotId: "bot-1",
      source: "EVENT",
      clientTurnId: `${RUN}:1:0`,
      background: { parentTurnId: "turn-0", destinationRoomId: "room-1" },
      presetRoute: { sandbox: false },
    });
  });

  it("is not finished while an article has no file, and is once it has one", async () => {
    const article = entry({ id: "seo-1", channel: "seo", format: "article" });
    const missing = await advanceCmoProduction(
      cuso([post({ draft: "Done." })], [], { calendar: [article] }),
      NOW,
    );
    expect(missing).toMatchObject({ state: "running", ready: 1, total: 2 });
    expect(startTurn.mock.calls[0]?.[0].message).toContain("seo-1");

    startTurn.mockClear();
    const written = await advanceCmoProduction(
      cuso(
        [post({ draft: "Done." })],
        [
          {
            clientTurnId: `${RUN}:1:1`,
            status: "COMPLETED",
            createdAt: hoursAgo(1),
          },
        ],
        {
          calendar: [article],
          files: new Map([
            [
              "seo-1",
              { fileId: "file-1", media: [], searchAd: null, adCampaign: null },
            ],
          ]),
        },
      ),
      NOW,
    );
    expect(written).toMatchObject({ state: "ready", ready: 2, total: 2 });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("reads the runs from Cuso's production turns", async () => {
    await advanceCmoProduction(cuso([post({})]), NOW);
    expect(turnFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sokoBotId: "bot-1",
          clientTurnId: { startsWith: "cmo:production:" },
        }),
      }),
    );
  });

  it("says starting, not running, while no run works yet", async () => {
    pgClock.now = new Date(APPROVED + 10 * 60 * 1_000);
    const read = await readCmoProduction(cuso([post({})]), {
      connected: new Set(),
      subscribed: true,
      now: NOW,
    });
    expect(read.status).toMatchObject({ state: "starting", written: 0 });
  });

  it("says blocked when no run started for half an hour, and still tries", async () => {
    pgClock.now = new Date(APPROVED + 31 * 60 * 1_000);
    const read = await readCmoProduction(cuso([post({})]), {
      connected: new Set(),
      subscribed: true,
      now: NOW,
    });
    expect(read.status.state).toBe("blocked");
    await advanceCmoProduction(cuso([post({})]), NOW);
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("leaves a working run alone", async () => {
    const result = await advanceCmoProduction(
      cuso(
        [post({})],
        [{ clientTurnId: `${RUN}:1:0`, status: "RUNNING", createdAt: NOW }],
      ),
      NOW,
    );
    expect(result.state).toBe("running");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("counts the month ready when every post is made, from when the run finished", async () => {
    const finished = hoursAgo(1);
    const result = await advanceCmoProduction(
      cuso(
        [post({ draft: "Done." }), post({ id: "old", status: "published" })],
        [
          {
            clientTurnId: `${RUN}:1:0`,
            status: "COMPLETED",
            createdAt: hoursAgo(2),
            completedAt: finished,
          },
        ],
      ),
      NOW,
    );
    expect(result).toMatchObject({
      state: "ready",
      ready: 1,
      total: 1,
      finishedAt: finished.toISOString(),
      pillars: null,
    });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("reviews a made month with the brand voice and rewrites under its own title", async () => {
    await advanceCmoProduction(
      cuso(
        [post({ draft: "Done." })],
        [
          {
            clientTurnId: `${RUN}:1:0`,
            status: "COMPLETED",
            createdAt: hoursAgo(2),
          },
        ],
      ),
      NOW,
    );
    const [input] = advanceCmoMonthReview.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      version: { id: "strategy-1" },
      voice: null,
      runIdPrefix: `${RUN}:`,
      ready: 1,
      strategy: { pillars: [{ name: "Recipes", share: 100 }] },
    });
    await input.startRewrite("Rewrite these", `${RUN}:review:1`);
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTurnId: `${RUN}:review:1`,
        message: "Rewrite these",
        background: expect.objectContaining({
          title: "Rewrite pieces that miss the strategy for Acme",
        }),
      }),
    );
  });

  it("shows the pillars Jev read beside the plan's", async () => {
    const owner = cuso(
      [post({ draft: "Done." })],
      [
        {
          clientTurnId: `${RUN}:review:1`,
          status: "RUNNING",
          createdAt: hoursAgo(1),
        },
      ],
    );
    approvedStrategy.mockResolvedValue({
      ...(await approvedStrategy()),
      monthReview: {
        round: 1,
        checkedAt: hoursAgo(1).toISOString(),
        pieces: { e1: "Recipes" },
        rewriteRunId: `${RUN}:review:1`,
      },
    });
    const result = await advanceCmoProduction(owner, NOW);
    expect(result.pillars).toEqual({
      shares: [{ name: "Recipes", planned: 100, made: 100, pieces: 1 }],
      rewriting: true,
    });
    expect(advanceCmoMonthReview).not.toHaveBeenCalled();
  });

  it("makes what the daily watch adds after the month is made", async () => {
    await advanceCmoProduction(
      cuso(
        [post({ draft: "Done." }), post({ id: "news" })],
        [
          {
            clientTurnId: `${RUN}:1:0`,
            status: "COMPLETED",
            createdAt: hoursAgo(48),
          },
        ],
      ),
      NOW,
    );
    const started = startTurn.mock.calls[0]?.[0];
    expect(started.clientTurnId).toBe(`${RUN}:2:1`);
    expect(started.message).toContain("The month is made.");
    expect(started.message).toContain("- news ·");
    expect(started.message).not.toContain("- e1 ·");
  });

  it("still starts the run when the pictures fail, logging no prompt", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "CMO pictures did not move on this round",
      ["Advancing the month's pictures threw"],
    );
    advanceMedia.mockRejectedValue(
      new Error("Image job failed for SENTINEL-PROMPT a sunlit bookshop"),
    );
    await advanceCmoProduction(
      cuso(
        [post({ draft: "Done." }), post({ id: "news" })],
        [
          {
            clientTurnId: `${RUN}:1:0`,
            status: "COMPLETED",
            createdAt: hoursAgo(48),
          },
        ],
      ),
      NOW,
    );
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(warnings[0]?.event).toMatchObject({
      operation: "cmo_media",
      sokoBot: { id: "bot-1" },
      failure: { errorName: "Error" },
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("SENTINEL-PROMPT");
  });

  it("logs a kicked run's warnings on their own event, not the request's", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "CMO pictures did not move on this round",
      ["Advancing the month's pictures threw"],
    );
    advanceMedia.mockRejectedValue(new Error("image studio down"));
    vi.mocked(findCusoForBot).mockResolvedValue(
      cuso([post({ draft: "Done." })], []) as never,
    );
    const app = new Hono();
    app.use(coreEvlogMiddleware());
    app.post("/kick", async (c) => {
      kickCmoProduction("bot-1");
      // waitUntil work can log while the request's event is still live.
      await vi.mocked(waitUntil).mock.calls[0]?.[0];
      return c.json({ ok: true });
    });
    await app.request("http://localhost/kick", { method: "POST" });
    expect(warnings[0]?.event).toMatchObject({ operation: "cmo_media" });
    expect(warnings[0]?.event.method).toBeUndefined();
    expect(warnings[0]?.event.path).toBeUndefined();
  });

  it("keeps a kicked run's turn-start warnings off the live request", async () => {
    const warnings = expectCoreLog("warn", "Turn start cleanup stand-in");
    // Stands in for the control plane's own cleanup warning while a turn
    // starts: mixed-context code, so it follows the background marker.
    startTurn.mockImplementation(async () => {
      recordCoreWarning(
        { operation: "soko_bot_turn_start" },
        { message: "Turn start cleanup stand-in", why: "A test stand-in" },
      );
      return { turnId: "run-1", status: "QUEUED" };
    });
    // The kick reads the clock; the fixtures are dated against NOW.
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    vi.mocked(findCusoForBot).mockResolvedValue(
      cuso([post({ id: "a" }), post({ id: "b" })]) as never,
    );
    const app = new Hono();
    app.use(coreEvlogMiddleware());
    app.post("/approve", async (c) => {
      kickCmoProduction("bot-1");
      // The work logs while the request's event is still live.
      await vi.mocked(waitUntil).mock.calls[0]?.[0];
      return c.json({ ok: true });
    });
    await app.request("http://localhost/approve", { method: "POST" });
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(warnings[0]?.event).toMatchObject({
      operation: "soko_bot_turn_start",
    });
    expect(warnings[0]?.event.method).toBeUndefined();
    expect(warnings[0]?.event.path).toBeUndefined();
  });

  it("stops after four runs in a day and tries again the next", async () => {
    pgClock.now = NOW;
    const runs = [1, 2, 3, 4].map((n) => ({
      clientTurnId: `${RUN}:${5 - n}:0`,
      status: "FAILED",
      createdAt: hoursAgo(n),
    }));
    const stuck = await advanceCmoProduction(cuso([post({})], runs), NOW);
    expect(stuck.state).toBe("stuck");
    expect(startTurn).not.toHaveBeenCalled();
    const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000);
    pgClock.now = nextDay;
    await advanceCmoProduction(cuso([post({})], runs), nextDay);
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("waits a day when the last run made nothing ready", async () => {
    pgClock.now = NOW;
    const posts = [
      post({ draft: "Done." }),
      post({ id: "img", format: "image", draft: "Words" }),
    ];
    // It started with one piece ready and ended with one.
    const runs = [
      { clientTurnId: `${RUN}:1:1`, status: "COMPLETED", createdAt: NOW },
    ];
    const stalled = await advanceCmoProduction(cuso(posts, runs), NOW);
    expect(stalled.state).toBe("stuck");
    expect(startTurn).not.toHaveBeenCalled();
    // A run that crashed is tried again at once.
    await advanceCmoProduction(
      cuso(posts, [{ ...runs[0]!, status: "FAILED" }]),
      NOW,
    );
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("starts afresh for a newly approved version", async () => {
    await advanceCmoProduction(
      cuso(
        [post({})],
        [
          {
            clientTurnId: "cmo:production:bot-1:1759309200000:1:0",
            status: "COMPLETED",
            createdAt: hoursAgo(30),
          },
        ],
      ),
      NOW,
    );
    expect(startTurn.mock.calls[0]?.[0].clientTurnId).toBe(`${RUN}:1:0`);
  });

  it("starts a newly approved version even when the version before used today's runs", async () => {
    // NMKR, 2026-11-19: three runs for the morning's version and a top-up a
    // minute before the new approval left the new month stuck until morning.
    pgClock.now = NOW;
    const earlier = [1, 2, 3, 4].map((n) => ({
      clientTurnId: `cmo:production:bot-1:1759309200000:${5 - n}:0`,
      status: "COMPLETED",
      createdAt: hoursAgo(n),
    }));
    const status = await advanceCmoProduction(cuso([post({})], earlier), NOW);
    expect(status.state).toBe("running");
    expect(startTurn.mock.calls[0]?.[0].clientTurnId).toBe(`${RUN}:1:0`);
  });

  it("has Core write the social pieces on cmo-v6 and lists only Cuso's own", async () => {
    botFindUnique.mockResolvedValue({ versionId: "cmo-v6" });
    await advanceCmoProduction(
      cuso([post({ id: "post-a" }), post({ id: "post-b" })]),
      NOW,
    );
    const message = startTurn.mock.calls[0]?.[0].message as string;
    expect(message).toContain(
      "Core writes 2 social pieces of the month for you: call write_month_pieces first, and again until left is 0.",
    );
    expect(message).not.toContain("- post-a");
    expect(message).not.toContain("Pieces (");
  });

  it("keeps cmo-v5's brief: every piece listed, no month writer", async () => {
    await advanceCmoProduction(cuso([post({ id: "post-a" })]), NOW);
    const message = startTurn.mock.calls[0]?.[0].message as string;
    expect(message).not.toContain("write_month_pieces");
    expect(message).toContain("- post-a");
  });

  it("waits for a run still working on the version approved before", async () => {
    const status = await advanceCmoProduction(
      cuso(
        [post({})],
        [
          {
            clientTurnId: "cmo:production:bot-1:1759309200000:1:0",
            status: "RUNNING",
            createdAt: hoursAgo(1),
          },
        ],
      ),
      NOW,
    );
    expect(status.state).toBe("running");
    expect(startTurn).not.toHaveBeenCalled();
  });
});

describe("cmoSyncOrder", () => {
  const cycle = (n: number) => new Date(n * 10 * 60 * 1000);

  it("starts each cycle one Cuso further along", () => {
    expect(cmoSyncOrder(["a", "b", "c"], cycle(0))).toEqual(["a", "b", "c"]);
    expect(cmoSyncOrder(["a", "b", "c"], cycle(1))).toEqual(["b", "c", "a"]);
    expect(cmoSyncOrder(["a", "b", "c"], cycle(5))).toEqual(["c", "a", "b"]);
  });

  it("keeps an empty list empty", () => {
    expect(cmoSyncOrder([], cycle(3))).toEqual([]);
  });
});

describe("syncCmoProduction", () => {
  it("points Cuso's rhythms at his runner once the hirer left", async () => {
    listCusos.mockResolvedValue([
      {
        sokoBotId: "bot-1",
        projectId: "project-1",
        workspaceId: "ws-1",
        websiteUrl: "https://acme.io",
        businessName: "acme.io",
      },
    ]);
    cmoRunnerUserId.mockResolvedValue("owner-2");
    scheduleUpdateMany.mockResolvedValue({ count: 5 });
    await syncCmoProduction();
    expect(scheduleUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        sokoBotId: "bot-1",
        systemKey: {
          in: expect.arrayContaining(["cmo-daily-run", "dreaming"]),
        },
      }),
      data: { requestedByUserId: "owner-2" },
    });
  });

  it("keeps each Cuso's first competitor check, beside his month", async () => {
    const cuso = {
      sokoBotId: "bot-1",
      projectId: "project-1",
      workspaceId: "ws-1",
      websiteUrl: "https://acme.io",
      businessName: "acme.io",
    };
    listCusos.mockResolvedValue([cuso]);
    cmoRunnerUserId.mockResolvedValue("owner-1");
    scheduleUpdateMany.mockResolvedValue({ count: 0 });
    const now = new Date("2026-11-18T21:00:00Z");
    await expect(syncCmoProduction(() => true, now)).resolves.toEqual({
      checked: 1,
    });
    expect(keepCusoFirstCompetitorCheck).toHaveBeenCalledWith(cuso, now);
  });

  it("logs each Cuso it skipped as its own event, without the error text", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "CMO production sync skipped a Cuso",
      [
        "Advancing this Cuso's production threw",
        "Advancing this Cuso's production threw",
      ],
    );
    const hire = (sokoBotId: string) => ({
      sokoBotId,
      projectId: `project-${sokoBotId}`,
      workspaceId: "ws-1",
      websiteUrl: "https://acme.io",
      businessName: "acme.io",
    });
    listCusos.mockResolvedValue([hire("bot-1"), hire("bot-2")]);
    cmoRunnerUserId.mockRejectedValue(
      new Error("Plan SENTINEL-PLAN launch week could not be read"),
    );
    await expect(syncCmoProduction()).resolves.toEqual({ checked: 0 });
    expect(warnings.map((warning) => warning.event.sokoBot)).toEqual(
      expect.arrayContaining([{ id: "bot-1" }, { id: "bot-2" }]),
    );
    expect(JSON.stringify(coreLogEvents())).not.toContain("SENTINEL-PLAN");
  });
});

describe("the month the plan bought", () => {
  /** Three X posts a day for two days, and a talking video shown on YouTube too. */
  const month = [
    ...["2026-11-10", "2026-11-11"].flatMap((date) =>
      ["a", "b", "c"].map((slot) =>
        post({ id: `x-${date}-${slot}`, date, channel: "x", format: "post" }),
      ),
    ),
    post({
      id: "v1",
      date: "2026-11-12",
      channel: "instagram",
      format: "talking_video",
    }),
    post({
      id: "v1@youtube",
      date: "2026-11-12",
      channel: "youtube",
      format: "talking_video",
      videoOf: "v1",
    }),
  ];
  const read = async (tier: string | null) => {
    subscriptionFindFirst.mockResolvedValueOnce(tier ? { tier } : null);
    return readCmoProduction(cuso(month), {
      connected: new Set(),
      subscribed: true,
      now: NOW,
    });
  };

  it("makes one X post a day on Starter, and the rest waits for a bigger plan", async () => {
    const { status, pieces } = await read("starter");
    expect(status.level).toBe("steady");
    expect(pieces.map((piece) => piece.id)).toEqual([
      "x-2026-11-10-a",
      "x-2026-11-11-a",
      "v1",
      "v1@youtube",
    ]);
    expect(status.total).toBe(4);
    expect(status.beyondPlan).toEqual([
      "x-2026-11-10-b",
      "x-2026-11-10-c",
      "x-2026-11-11-b",
      "x-2026-11-11-c",
    ]);
  });

  it("makes more of the same month on Growth, and all of it on Scale", async () => {
    expect((await read("growth")).status).toMatchObject({
      level: "active",
      total: 6,
    });
    expect((await read("scale")).status).toMatchObject({
      level: "all_in",
      total: 8,
      beyondPlan: [],
    });
  });

  it("makes all of it on Tester credits, with no plan bought", async () => {
    expect((await read(null)).status).toMatchObject({
      level: "all_in",
      total: 8,
    });
  });
});

// cmo-v8: NMKR's month opened two posts on "One G2 review, rated 4.0/5"
// whose reviewer found the fees "somewhat high".
describe("cmoPraiseOnly", () => {
  const lukewarm =
    "One G2 review rates NMKR Studio 4.0/5 and says its percentage fees feel somewhat high.";
  const praise = "TURF says NMKR's API saved countless development hours.";
  const fact = "Book.io sold over 130,000 NFTs with NMKR.";

  it("keeps clear praise and facts and leaves out a lukewarm review", async () => {
    const evaluate = vi.fn(
      async ({ state }: { state: { points: { point: string }[] } }) => ({
        answers: new Map(
          state.points.map(({ point }, index) => [
            `p${index}`,
            { type: "boolean", probability: point === lukewarm ? 0.1 : 0.9 },
          ]),
        ),
        costUsd: 0.000_1,
      }),
    );
    const kept = await cmoPraiseOnly(
      [praise, lukewarm, fact],
      evaluate as never,
    );
    expect(kept.points).toEqual([praise, fact]);
    // Read once: the same points ask Jev nothing again.
    const again = await cmoPraiseOnly(
      [praise, lukewarm, fact],
      evaluate as never,
    );
    expect(again).toEqual({ points: [praise, fact], costUsd: 0 });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("leaves out an unread review when Jev does not answer", async () => {
    const evaluate = vi.fn(async () => {
      throw new Error("timeout");
    });
    const other = "A G2 reviewer gave NMKR Studio 3 stars for support.";
    const kept = await cmoPraiseOnly(
      ["NMKR Studio lists a project audit at 150 ADA.", other],
      evaluate as never,
    );
    expect(kept.points).toEqual([
      "NMKR Studio lists a project audit at 150 ADA.",
    ]);
  });
});
