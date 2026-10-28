import type { CmoCalendarEntry, CmoStrategy } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  hireUpdate,
  turnFindUnique,
  turnFindFirst,
  botFindUniqueOrThrow,
  startTurn,
  isCmoSubscribed,
  listCmoChannels,
} = vi.hoisted(() => ({
  hireUpdate: vi.fn(),
  turnFindUnique: vi.fn(),
  turnFindFirst: vi.fn(),
  botFindUniqueOrThrow: vi.fn(),
  startTurn: vi.fn(),
  isCmoSubscribed: vi.fn(),
  listCmoChannels: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    cmoHire: { update: hireUpdate },
    sokoBotTurn: { findUnique: turnFindUnique, findFirst: turnFindFirst },
    sokoBot: { findUniqueOrThrow: botFindUniqueOrThrow },
  },
}));

vi.mock("@/services/cmo.service", () => ({
  isCmoSubscribed,
  listCmoChannels,
  parseCmoStrategy: (value: unknown) => value ?? null,
}));

vi.mock("@/services/soko-bot-chat.service", () => ({
  findOrOpenOwnerDirectRoom: async () => ({ id: "room-1" }),
}));

vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { startTurn, reconcileTurn: vi.fn() },
}));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import {
  advanceCmoProduction,
  cmoMixLedger,
  cmoPieceReady,
  cmoProductionMessage,
} from "./cmo-production.service";

const NOW = new Date("2026-11-02T08:00:00Z");
const APPROVED = Date.parse("2026-11-01T09:00:00Z");

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

function strategy(calendar: CmoCalendarEntry[]): CmoStrategy {
  return {
    month: "2026-11",
    summary: "Seed recipe videos, then the first-order offer.",
    goals: ["More first orders"],
    mix: [
      { approach: "educational", share: 60, why: "Teach quick dinners" },
      { approach: "promotional", share: 40, why: "The first-order offer" },
    ],
    calendar,
  } as unknown as CmoStrategy;
}

function hire(calendar: CmoCalendarEntry[], production?: unknown) {
  return {
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    sokoBotId: "bot-1",
    projectId: "project-1",
    businessName: "Acme",
    strategy: strategy(calendar),
    strategyApprovedAt: new Date("2026-11-01T09:00:00Z"),
    production: production ?? null,
  } as never;
}

describe("cmoPieceReady", () => {
  const connected = new Set(["instagram"]);

  it("needs the words, the picture its format has, and a post on a connected network", () => {
    expect(cmoPieceReady(entry({}), connected)).toBe(false);
    expect(cmoPieceReady(entry({ draft: "Ready to post." }), connected)).toBe(
      true,
    );
    const image = entry({
      channel: "linkedin",
      format: "image",
      draft: "Words",
    });
    expect(cmoPieceReady(image, connected)).toBe(false);
    expect(cmoPieceReady({ ...image, imageFileId: "file-1" }, connected)).toBe(
      true,
    );
    const instagram = entry({
      channel: "instagram",
      format: "image",
      draft: "Words",
      imageFileId: "file-1",
    });
    expect(cmoPieceReady(instagram, connected)).toBe(false);
    expect(
      cmoPieceReady(
        {
          ...instagram,
          socialPostId: "00000000-0000-4000-8000-000000000001",
        },
        connected,
      ),
    ).toBe(true);
  });

  it("counts published and skipped pieces as done", () => {
    expect(cmoPieceReady(entry({ status: "published" }), connected)).toBe(true);
    expect(cmoPieceReady(entry({ status: "skipped" }), connected)).toBe(true);
  });
});

describe("cmoProductionMessage", () => {
  it("lists every piece with its approach and the mix as the calendar holds it", () => {
    const calendar = [
      entry({ id: "a", approach: "educational" }),
      entry({ id: "b", approach: "promotional", channel: "x" }),
    ];
    const message = cmoProductionMessage({
      businessName: "Acme",
      strategy: strategy(calendar),
      pending: calendar,
      connected: new Set(["x"]),
      attempt: 1,
      topUp: false,
    });
    expect(message).toContain("- a · 2026-11-05 09:00 · linkedin/text");
    expect(message).toContain("Connected networks: x");
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
      pending: [entry({})],
      connected: new Set(),
      attempt: 3,
      topUp: true,
    });
    expect(message).toContain("The month is made.");
    expect(message).toContain("Connected networks: none yet");
  });
});

describe("advanceCmoProduction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isCmoSubscribed.mockResolvedValue(true);
    listCmoChannels.mockResolvedValue([]);
    turnFindFirst.mockResolvedValue({ id: "turn-0" });
    botFindUniqueOrThrow.mockResolvedValue({
      id: "bot-1",
      userId: "user-1",
      workspaceId: "ws-1",
      workspace: { organizationId: null },
    });
    startTurn.mockResolvedValue({ turnId: "run-1", status: "QUEUED" });
  });

  it("waits until the plan is approved and paid for", async () => {
    isCmoSubscribed.mockResolvedValue(false);
    const result = await advanceCmoProduction(hire([entry({})]), NOW);
    expect(result.state).toBe("waiting");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("starts one background run for the whole month, under Cuso's newest turn", async () => {
    const result = await advanceCmoProduction(
      hire([entry({ id: "a" }), entry({ id: "b" })]),
      NOW,
    );
    expect(result).toMatchObject({ state: "running", ready: 0, total: 2 });
    const started = startTurn.mock.calls[0]?.[0];
    expect(started).toMatchObject({
      sokoBotId: "bot-1",
      source: "EVENT",
      clientTurnId: `cmo:production:cmo-1:2026-11:${APPROVED}:1`,
      background: { parentTurnId: "turn-0", destinationRoomId: "room-1" },
      presetRoute: { sandbox: false },
    });
    expect(hireUpdate.mock.calls[0]?.[0].data.production.runs).toEqual([
      { id: "run-1", at: NOW.toISOString(), ready: 0 },
    ]);
  });

  it("leaves a working run alone", async () => {
    turnFindUnique.mockResolvedValue({ status: "RUNNING" });
    const result = await advanceCmoProduction(
      hire([entry({})], {
        month: "2026-11",
        startedAt: NOW.toISOString(),
        runs: [{ id: "run-1", at: NOW.toISOString() }],
      }),
      NOW,
    );
    expect(result.state).toBe("running");
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("records when every piece is made", async () => {
    const result = await advanceCmoProduction(
      hire([entry({ draft: "Done." })], {
        month: "2026-11",
        startedAt: NOW.toISOString(),
        runs: [{ id: "run-1", at: NOW.toISOString() }],
      }),
      NOW,
    );
    expect(result).toMatchObject({
      state: "ready",
      ready: 1,
      total: 1,
      finishedAt: NOW.toISOString(),
    });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it("makes what the daily watch adds after the month is made", async () => {
    turnFindUnique.mockResolvedValue({ status: "COMPLETED" });
    await advanceCmoProduction(
      hire([entry({ draft: "Done." }), entry({ id: "news" })], {
        month: "2026-11",
        startedAt: NOW.toISOString(),
        runs: [{ id: "run-1", at: "2026-10-30T08:00:00Z" }],
        finishedAt: "2026-10-30T10:00:00Z",
      }),
      NOW,
    );
    const started = startTurn.mock.calls[0]?.[0];
    expect(started.clientTurnId).toBe(
      `cmo:production:cmo-1:2026-11:${APPROVED}:2`,
    );
    expect(started.message).toContain("The month is made.");
    expect(started.message).toContain("- news ·");
    expect(started.message).not.toContain("- e1 ·");
  });

  it("stops after four runs in a day and tries again the next", async () => {
    turnFindUnique.mockResolvedValue({ status: "FAILED" });
    const runs = [1, 2, 3, 4].map((n) => ({
      id: `run-${n}`,
      at: new Date(NOW.getTime() - n * 60 * 60 * 1_000).toISOString(),
    }));
    const production = { month: "2026-11", startedAt: runs[3]?.at, runs };
    const stuck = await advanceCmoProduction(
      hire([entry({})], production),
      NOW,
    );
    expect(stuck.state).toBe("stuck");
    expect(startTurn).not.toHaveBeenCalled();
    const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1_000);
    await advanceCmoProduction(
      hire([entry({ date: "2026-11-05" })], production),
      nextDay,
    );
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("waits a day when the last run made nothing ready", async () => {
    turnFindUnique.mockResolvedValue({ status: "COMPLETED" });
    const production = {
      month: "2026-11",
      startedAt: NOW.toISOString(),
      runs: [{ id: "run-1", at: NOW.toISOString(), ready: 1 }],
    };
    const calendar = [
      entry({ draft: "Done." }),
      entry({ id: "img", format: "image", draft: "Words" }),
    ];
    const stalled = await advanceCmoProduction(hire(calendar, production), NOW);
    expect(stalled.state).toBe("stuck");
    expect(startTurn).not.toHaveBeenCalled();
    // A run that crashed is tried again at once.
    turnFindUnique.mockResolvedValue({ status: "FAILED" });
    await advanceCmoProduction(hire(calendar, production), NOW);
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("starts a new production for a new month", async () => {
    await advanceCmoProduction(
      hire([entry({})], {
        month: "2026-10",
        startedAt: "2026-10-01T09:00:00Z",
        runs: [{ id: "old", at: "2026-10-01T09:00:00Z" }],
        finishedAt: "2026-10-01T11:00:00Z",
      }),
      NOW,
    );
    expect(startTurn.mock.calls[0]?.[0].clientTurnId).toBe(
      `cmo:production:cmo-1:2026-11:${APPROVED}:1`,
    );
  });
});
