import type { CmoCalendarEntry, CmoStrategy } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketingStrategyPost } from "@/services/marketing-strategy.service";

const {
  turnFindMany,
  turnFindFirst,
  botFindUniqueOrThrow,
  startTurn,
  isCmoSubscribed,
  listCmoChannels,
  cmoRunnerUserId,
  listCusos,
  scheduleUpdateMany,
  approvedStrategy,
  listPosts,
} = vi.hoisted(() => ({
  approvedStrategy: vi.fn(),
  listPosts: vi.fn(),
  cmoRunnerUserId: vi.fn(),
  listCusos: vi.fn(),
  scheduleUpdateMany: vi.fn(),
  turnFindMany: vi.fn(),
  turnFindFirst: vi.fn(),
  botFindUniqueOrThrow: vi.fn(),
  startTurn: vi.fn(),
  isCmoSubscribed: vi.fn(),
  listCmoChannels: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotSchedule: { updateMany: scheduleUpdateMany },
    sokoBotTurn: { findMany: turnFindMany, findFirst: turnFindFirst },
    sokoBot: { findUniqueOrThrow: botFindUniqueOrThrow },
  },
}));

vi.mock("@/services/cmo-cuso.service", () => ({
  findCusoForBot: vi.fn(),
  listCusosWithApprovedStrategy: listCusos,
  cmoRunnerUserId,
  listCmoChannels,
}));
vi.mock("@/services/cmo-billing.service", () => ({ isCmoSubscribed }));
vi.mock("@/services/marketing-strategy.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/marketing-strategy.service")
  >()),
  approvedMarketingStrategy: approvedStrategy,
  listMarketingStrategyPosts: listPosts,
}));

vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { startTurn, reconcileTurn: vi.fn() },
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import {
  advanceCmoProduction,
  type CmoPiece,
  cmoMixLedger,
  cmoPieceReady,
  cmoProductionMessage,
  cmoReadyPieceIds,
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

function strategy(calendar: CmoCalendarEntry[]): CmoStrategy {
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
  } as unknown as CmoStrategy;
}

/** Production turns of Cuso's bot, newest first, as the runs query reads them. */
type Run = {
  clientTurnId: string;
  status: string;
  createdAt: Date;
  completedAt?: Date | null;
};

/** A hire whose Project's approved version became these Social posts. */
function cuso(posts: MarketingStrategyPost[], runs: Run[] = []) {
  approvedStrategy.mockResolvedValue({
    id: "strategy-1",
    projectId: "project-1",
    plan: strategy([]),
    approvedAt: new Date(APPROVED),
  });
  listPosts.mockResolvedValue(posts);
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

  it("counts published and skipped pieces as done", () => {
    expect(cmoPieceReady(piece({ status: "published" }), connected)).toBe(true);
    expect(cmoPieceReady(piece({ status: "skipped" }), connected)).toBe(true);
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
    expect(message).toContain("educational 1 of 2 (plan 60%)");
    expect(message).toContain("report_update kind production");
    expect(message).toContain("DONE:");
    expect(cmoMixLedger(strategy(calendar))).toBe(
      "educational 1 of 2 (plan 60%), promotional 1 of 2 (plan 40%)",
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

  it("has a carousel's slides made from its cover", () => {
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy([]),
      pending: [
        piece({ channel: "instagram", format: "carousel" }, [
          "drive/photo.png",
        ]),
      ],
      connected: new Set(),
      attempt: 1,
      topUp: true,
    });
    expect(message).toContain("carousel: at least 3 slides, 1 made");
    expect(message).toContain("referenceFileIds");
  });
});

describe("advanceCmoProduction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isCmoSubscribed.mockResolvedValue(true);
    listCmoChannels.mockResolvedValue([]);
    turnFindFirst.mockResolvedValue({ id: "turn-0" });
    botFindUniqueOrThrow.mockResolvedValue({ sharedRoomId: "room-1" });
    cmoRunnerUserId.mockResolvedValue("user-1");
    startTurn.mockResolvedValue({ turnId: "run-1", status: "QUEUED" });
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
    });
    expect(startTurn).not.toHaveBeenCalled();
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

  it("stops after four runs in a day and tries again the next", async () => {
    const runs = [1, 2, 3, 4].map((n) => ({
      clientTurnId: `${RUN}:${5 - n}:0`,
      status: "FAILED",
      createdAt: hoursAgo(n),
    }));
    const stuck = await advanceCmoProduction(cuso([post({})], runs), NOW);
    expect(stuck.state).toBe("stuck");
    expect(startTurn).not.toHaveBeenCalled();
    const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000);
    await advanceCmoProduction(cuso([post({})], runs), nextDay);
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("waits a day when the last run made nothing ready", async () => {
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
        systemKey: { in: expect.arrayContaining(["cmo-daily-run"]) },
      }),
      data: { requestedByUserId: "owner-2" },
    });
  });
});
