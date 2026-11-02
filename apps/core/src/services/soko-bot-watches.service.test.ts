import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, startTurnMock } = vi.hoisted(() => ({
  db: {
    projectImageJob: { findUnique: vi.fn(), findFirst: vi.fn() },
    sokoBotTurn: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    chatRoomMessage: { findMany: vi.fn() },
    chatRoomSokoBotMember: { findUnique: vi.fn() },
    sokoBotIntegration: { findUnique: vi.fn() },
    sokoBotWatch: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  },
  startTurnMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/services/soko-bot-control-plane.service", () => {
  class SokoBotBusyError extends Error {}
  return {
    SokoBotBusyError,
    sokoBotControlPlane: {
      startTurn: startTurnMock,
      reconcileTurn: vi.fn(async () => undefined),
    },
  };
});
vi.mock("@/services/soko-bot-runtime.service", () => ({
  SokoBotRuntimeValidationError: class extends Error {},
}));

import {
  followUpConnectedApp,
  followUpMessage,
  registerWatch,
  syncSokoBotWatches,
  watchOutcome,
} from "./soko-bot-watches.service";

const NOW = new Date("2026-11-01T10:00:00.000Z");

const authorized = (overrides: Record<string, unknown> = {}) =>
  ({
    turn: {
      id: "turn-1",
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
      actingUserId: "user-1",
      requestedByUserId: "user-1",
      eveSessionId: null,
      versionId: "v31",
      source: "CHAT",
      chainDepth: 0,
    },
    reader: { sharedScope: null },
    ...overrides,
  }) as never;

const studio = {
  kind: "studio_job",
  targetId: "job-1",
  projectId: "project-1",
  sokoBotId: "bot-1",
  createdAt: NOW,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  db.sokoBotTurn.findUniqueOrThrow.mockResolvedValue({
    parentTurnId: null,
    askedByUserId: null,
    chainDepth: 0,
  });
  db.sokoBotWatch.count.mockResolvedValue(0);
  db.projectImageJob.findFirst.mockResolvedValue({ id: "job-1" });
  db.sokoBotWatch.create.mockImplementation(async ({ data }) => ({
    id: "watch-1",
    expiresAt: data.expiresAt,
  }));
});

describe("watchOutcome", () => {
  it("waits while an image is being made, and says how to read it once ready", async () => {
    db.projectImageJob.findUnique.mockResolvedValueOnce({
      status: "RUNNING",
      kind: "GENERATE",
    });
    expect(await watchOutcome(studio)).toBeNull();
    db.projectImageJob.findUnique.mockResolvedValueOnce({
      status: "SUCCEEDED",
      kind: "GENERATE",
    });
    expect(await watchOutcome(studio)).toContain(
      "Call get_image with jobId job-1 and projectId project-1",
    );
    db.projectImageJob.findUnique.mockResolvedValueOnce({
      status: "FAILED",
      kind: "TEXT_TO_VIDEO",
    });
    expect(await watchOutcome(studio)).toContain("ended FAILED");
  });

  it("hands over a finished background run's report", async () => {
    const run = { ...studio, kind: "background_run", targetId: "run-1" };
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({ status: "RUNNING" });
    expect(await watchOutcome(run)).toBeNull();
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({
      status: "COMPLETED",
      finalAnswer: "Built the CRM table.",
      backgroundTitle: "CRM",
    });
    expect(await watchOutcome(run)).toBe(
      'The background run "CRM" ended COMPLETED. Its report: Built the CRM table.',
    );
  });

  it("counts only replies from others after the wait began", async () => {
    const chat = { ...studio, kind: "chat_reply", targetId: "room-1" };
    db.chatRoomMessage.findMany.mockResolvedValueOnce([]);
    expect(await watchOutcome(chat)).toBeNull();
    expect(db.chatRoomMessage.findMany.mock.calls[0][0].where).toMatchObject({
      roomId: "room-1",
      createdAt: { gt: NOW },
      OR: [{ senderSokoBotId: null }, { senderSokoBotId: { not: "bot-1" } }],
    });
    db.chatRoomMessage.findMany.mockResolvedValueOnce([
      {
        content: "Yes, about 200 credits.",
        senderUser: null,
        senderCoworker: { name: "Hannah" },
        senderSokoBot: null,
      },
    ]);
    expect(await watchOutcome(chat)).toContain(
      "- Hannah: Yes, about 200 credits.",
    );
  });
});

describe("followUpMessage", () => {
  it("carries the result and the plan, and says not to ask again", () => {
    const text = followUpMessage({
      then: "post it in #Sokosumi",
      outcome: "The image is ready.",
      timedOut: false,
    });
    expect(text).toContain("The image is ready.");
    expect(text).toContain("Your plan: post it in #Sokosumi");
    expect(text).toContain("do not ask again");
    expect(text).toContain("DONE:");
  });
});

describe("registerWatch", () => {
  const input = {
    kind: "studio_job" as const,
    id: "job-1",
    projectId: "project-1",
    then: "post it in #Sokosumi",
  };

  const queued = () =>
    db.projectImageJob.findUnique.mockResolvedValue({
      status: "QUEUED",
      kind: "GENERATE",
    });

  it("waits an hour by default and belongs to the turn that asked", async () => {
    queued();
    const result = await registerWatch(authorized(), input);
    expect(result).toMatchObject({ waiting: true, watchId: "watch-1" });
    expect(db.sokoBotWatch.create.mock.calls[0][0].data).toMatchObject({
      turnId: "turn-1",
      kind: "studio_job",
      targetId: "job-1",
      then: "post it in #Sokosumi",
      expiresAt: new Date("2026-11-01T11:00:00.000Z"),
    });
  });

  it("says at once when it is already done, instead of waiting", async () => {
    db.projectImageJob.findUnique.mockResolvedValue({
      status: "SUCCEEDED",
      kind: "GENERATE",
    });
    const result = await registerWatch(authorized(), input);
    expect(result).toMatchObject({ waiting: false });
    expect(db.sokoBotWatch.create).not.toHaveBeenCalled();
  });

  it("works for a teammate's request and a shared bot too", async () => {
    queued();
    await expect(
      registerWatch(authorized({ reader: { sharedScope: {} } }), input),
    ).resolves.toMatchObject({ waiting: true });
  });

  it("lets a follow-up wait again, for the turn the owner asked in", async () => {
    db.sokoBotTurn.findUniqueOrThrow.mockResolvedValueOnce({
      parentTurnId: "turn-0",
      askedByUserId: null,
      chainDepth: 0,
    });
    db.sokoBotWatch.findFirst.mockResolvedValueOnce({ turnId: "turn-0" });
    db.chatRoomSokoBotMember.findUnique.mockResolvedValueOnce({ id: "m" });
    await registerWatch(authorized(), {
      kind: "chat_reply",
      id: "room-1",
      then: "summarise the answers",
    });
    expect(db.sokoBotWatch.create.mock.calls[0][0].data.turnId).toBe("turn-0");
  });

  it("lets a background run wait, for the turn that started it", async () => {
    queued();
    db.sokoBotTurn.findUniqueOrThrow.mockResolvedValueOnce({
      parentTurnId: "turn-0",
    });
    db.sokoBotWatch.findFirst.mockResolvedValueOnce(null);
    await registerWatch(authorized(), input);
    expect(db.sokoBotWatch.create.mock.calls[0][0].data.turnId).toBe("turn-0");
  });

  it("needs the Project of a Studio job and a room the bot is in", async () => {
    await expect(
      registerWatch(authorized(), { ...input, projectId: undefined }),
    ).rejects.toThrow("projectId is required");
    db.chatRoomSokoBotMember.findUnique.mockResolvedValueOnce(null);
    await expect(
      registerWatch(authorized(), {
        kind: "chat_reply",
        id: "room-x",
        then: "x",
      }),
    ).rejects.toThrow("not in that chat room");
  });
});

describe("syncSokoBotWatches", () => {
  const waiting = (overrides: Record<string, unknown> = {}) => ({
    id: "watch-1",
    kind: "studio_job",
    targetId: "job-1",
    projectId: "project-1",
    sokoBotId: "bot-1",
    createdAt: new Date("2026-11-01T09:55:00.000Z"),
    expiresAt: new Date("2026-11-01T10:55:00.000Z"),
    then: "post it in #Sokosumi, room room-9",
    turn: {
      id: "turn-1",
      requestedByUserId: "user-1",
      askedByUserId: null,
      chainDepth: 0,
      workspaceId: "ws-1",
      source: "CHAT",
      versionId: "v31",
      capabilityNames: ["post_chat", "get_image", "start_background_run"],
      destinationRoomId: "dm-1",
    },
    ...overrides,
  });
  const sync = () => syncSokoBotWatches({ shouldContinue: () => true });

  beforeEach(() => {
    db.sokoBotWatch.updateMany.mockResolvedValue({ count: 1 });
    startTurnMock.mockResolvedValue({ turnId: "follow-1", status: "QUEUED" });
  });

  it("starts the plan as a run of the asking turn, with its tools, posting where it was asked", async () => {
    db.sokoBotWatch.findMany.mockResolvedValue([waiting()]);
    db.projectImageJob.findUnique.mockResolvedValue({
      status: "SUCCEEDED",
      kind: "GENERATE",
    });
    expect(await sync()).toMatchObject({ fired: 1 });
    const start = startTurnMock.mock.calls[0][0];
    expect(start).toMatchObject({
      clientTurnId: "watch:watch-1",
      source: "CHAT",
      sokoBotId: "bot-1",
      background: { parentTurnId: "turn-1", destinationRoomId: "dm-1" },
    });
    expect(start.presetRoute.capabilities).toEqual(["post_chat", "get_image"]);
    expect(start.message).toContain(
      "Your plan: post it in #Sokosumi, room room-9",
    );
    expect(db.sokoBotWatch.update).toHaveBeenCalledWith({
      where: { id: "watch-1" },
      data: { firedTurnId: "follow-1" },
    });
  });

  it("runs a teammate's follow-up for that teammate, not the owner", async () => {
    db.sokoBotWatch.findMany.mockResolvedValue([
      waiting({
        turn: {
          ...waiting().turn,
          askedByUserId: "teammate-1",
          destinationRoomId: "channel-1",
        },
      }),
    ]);
    db.projectImageJob.findUnique.mockResolvedValue({
      status: "SUCCEEDED",
      kind: "GENERATE",
    });
    await sync();
    const start = startTurnMock.mock.calls[0][0];
    expect(start.chat).toEqual({
      askedByUserId: "teammate-1",
      askedByBot: false,
      chainDepth: 0,
    });
    expect(start.background.destinationRoomId).toBe("channel-1");
  });

  it("keeps waiting while the image is being made", async () => {
    db.sokoBotWatch.findMany.mockResolvedValue([waiting()]);
    db.projectImageJob.findUnique.mockResolvedValue({
      status: "RUNNING",
      kind: "GENERATE",
    });
    expect(await sync()).toMatchObject({ checked: 1, fired: 0 });
    expect(startTurnMock).not.toHaveBeenCalled();
  });

  it("runs the plan with what there is once time is up", async () => {
    vi.setSystemTime(new Date("2026-11-01T11:00:00.000Z"));
    db.sokoBotWatch.findMany.mockResolvedValue([waiting()]);
    db.projectImageJob.findUnique.mockResolvedValue({
      status: "RUNNING",
      kind: "GENERATE",
    });
    expect(await sync()).toMatchObject({ fired: 1 });
    expect(startTurnMock.mock.calls[0][0].message).toContain(
      "did not finish in time",
    );
  });

  it("starts nothing when another tick already claimed it", async () => {
    db.sokoBotWatch.findMany.mockResolvedValue([waiting()]);
    db.projectImageJob.findUnique.mockResolvedValue({
      status: "SUCCEEDED",
      kind: "GENERATE",
    });
    db.sokoBotWatch.updateMany.mockResolvedValue({ count: 0 });
    await sync();
    expect(startTurnMock).not.toHaveBeenCalled();
  });

  it("puts it back for the next tick when the bot is busy", async () => {
    const { SokoBotBusyError } = await import(
      "@/services/soko-bot-control-plane.service"
    );
    db.sokoBotWatch.findMany.mockResolvedValue([waiting()]);
    db.projectImageJob.findUnique.mockResolvedValue({
      status: "SUCCEEDED",
      kind: "GENERATE",
    });
    startTurnMock.mockRejectedValueOnce(new SokoBotBusyError("busy"));
    expect(await sync()).toMatchObject({ deferred: 1 });
    expect(db.sokoBotWatch.update).toHaveBeenCalledWith({
      where: { id: "watch-1" },
      data: { status: "WAITING", firedAt: null, outcome: null },
    });
  });

  describe("an app being connected", () => {
    const app = (overrides: Record<string, unknown> = {}) =>
      waiting({
        kind: "app_connected",
        targetId: "hubspot",
        projectId: null,
        then: "count the open HubSpot deals",
        ...overrides,
      });

    it("checks only that bot when asked, and fires with the app's tools", async () => {
      db.sokoBotWatch.findMany.mockResolvedValue([app()]);
      db.sokoBotIntegration.findUnique.mockResolvedValue({ status: "ACTIVE" });
      await syncSokoBotWatches({
        shouldContinue: () => true,
        sokoBotId: "bot-1",
      });
      expect(db.sokoBotWatch.findMany.mock.calls[0][0].where).toEqual({
        status: "WAITING",
        sokoBotId: "bot-1",
      });
      const start = startTurnMock.mock.calls[0][0];
      expect(start.presetRoute.capabilities).toEqual([
        "post_chat",
        "get_image",
        "list_integration_tools",
        "run_integration_tool",
      ]);
      expect(start.message).toContain("hubspot is connected now");
    });

    it("keeps waiting until it is connected", async () => {
      db.sokoBotWatch.findMany.mockResolvedValue([app()]);
      db.sokoBotIntegration.findUnique.mockResolvedValue({ status: "PENDING" });
      expect(await sync()).toMatchObject({ fired: 0 });
    });

    it("just ends when nobody connected it in time", async () => {
      vi.setSystemTime(new Date("2026-11-01T11:00:00.000Z"));
      db.sokoBotWatch.findMany.mockResolvedValue([app()]);
      db.sokoBotIntegration.findUnique.mockResolvedValue(null);
      await sync();
      expect(startTurnMock).not.toHaveBeenCalled();
      expect(db.sokoBotWatch.updateMany).toHaveBeenCalledWith({
        where: { id: "watch-1", status: "WAITING" },
        data: { status: "EXPIRED", outcome: "never connected" },
      });
    });

    it("waits a day by default and needs a provider slug", async () => {
      db.sokoBotIntegration.findUnique.mockResolvedValue(null);
      await registerWatch(authorized(), {
        kind: "app_connected",
        id: "hubspot",
        then: "count the open deals",
      });
      expect(db.sokoBotWatch.create.mock.calls[0][0].data.expiresAt).toEqual(
        new Date("2026-11-02T10:00:00.000Z"),
      );
      await expect(
        registerWatch(authorized(), {
          kind: "app_connected",
          id: "Hub Spot",
          then: "x",
        }),
      ).rejects.toThrow("provider from find_integrations");
    });
  });

  describe("followUpConnectedApp", () => {
    beforeEach(() => {
      db.sokoBotWatch.findMany.mockResolvedValue([]);
    });

    it("follows up the answer that gave the app's link", async () => {
      db.sokoBotTurn.findMany.mockResolvedValue([
        {
          id: "turn-other",
          userMessage: "x",
          finalAnswer: "[Connect](/personal-assistant?connect=hubspot_crm)",
        },
        {
          id: "turn-1",
          userMessage: "How many open deals do I have?",
          finalAnswer: "[Connect HubSpot](/personal-assistant?connect=hubspot)",
        },
      ]);
      db.sokoBotWatch.findFirst.mockResolvedValue(null);
      await followUpConnectedApp("bot-1", "hubspot");
      expect(db.sokoBotWatch.create.mock.calls[0][0].data).toMatchObject({
        sokoBotId: "bot-1",
        turnId: "turn-1",
        kind: "app_connected",
        targetId: "hubspot",
        then: 'Finish what was asked, which needed hubspot: "How many open deals do I have?"',
      });
      expect(db.sokoBotWatch.findMany.mock.calls[0][0].where).toEqual({
        status: "WAITING",
        sokoBotId: "bot-1",
      });
    });

    it("uses the wait the bot set itself", async () => {
      db.sokoBotTurn.findMany.mockResolvedValue([
        {
          id: "turn-1",
          userMessage: "deals?",
          finalAnswer: "/personal-assistant?connect=hubspot",
        },
      ]);
      db.sokoBotWatch.findFirst.mockResolvedValue({ id: "watch-0" });
      await followUpConnectedApp("bot-1", "hubspot");
      expect(db.sokoBotWatch.create).not.toHaveBeenCalled();
    });

    it("does nothing new when no answer gave the link", async () => {
      db.sokoBotTurn.findMany.mockResolvedValue([]);
      await followUpConnectedApp("bot-1", "hubspot");
      expect(db.sokoBotWatch.create).not.toHaveBeenCalled();
    });
  });
});
