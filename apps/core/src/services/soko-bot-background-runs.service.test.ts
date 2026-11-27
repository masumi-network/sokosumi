import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueOrThrow, findMany, findFirst, startTurn, cancelTurn } =
  vi.hoisted(() => ({
    findUniqueOrThrow: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    startTurn: vi.fn(),
    cancelTurn: vi.fn(),
  }));

const reconcileTurn = vi.fn().mockResolvedValue(undefined);
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotTurn: { findUniqueOrThrow, findMany, findFirst } },
}));
vi.mock("@/services/soko-bot-runtime.service", () => ({
  SokoBotRuntimeValidationError: class SokoBotRuntimeValidationError extends Error {},
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  sokoBotControlPlane: { startTurn, cancelTurn, reconcileTurn },
}));

import type { AuthorizedSokoBotRuntime } from "@/services/soko-bot-runtime.service";
import {
  listBackgroundRuns,
  startBackgroundRun,
  stopBackgroundRun,
} from "./soko-bot-background-runs.service";

const authorized = {
  provenance: { network: "mainnet" },
  turn: {
    id: "parent-turn",
    sokoBotId: "bot",
    actingUserId: "owner",
    requestedByUserId: "owner",
    workspaceId: "workspace",
    versionId: "v24",
  },
  reader: { sharedScope: null },
  grant: {
    capabilities: [
      "search_inbox",
      "create_table",
      "write_table_rows",
      "bash",
      "start_background_run",
      "stop_background_run",
      "list_background_runs",
    ],
  },
} as unknown as AuthorizedSokoBotRuntime;

const ownerParent = {
  source: "CHAT",
  parentTurnId: null,
  requestedByUserId: "owner",
  askedByUserId: null,
  chainDepth: 0,
  destinationRoomId: "room-owner",
  sokoBot: { sharedRoomId: null },
};

describe("background runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a run beside the chat with the turn's tools, minus starting more", async () => {
    findUniqueOrThrow.mockResolvedValue(ownerParent);
    startTurn.mockResolvedValue({
      turnId: "run-1",
      status: "RUNNING",
      reconciliationLeaseToken: "lease",
    });
    const result = await startBackgroundRun(authorized, {
      title: "Gmail CRM",
      brief: "Go through Gmail since 2023-10-13 into table t-1.",
    });
    expect(result).toMatchObject({ runId: "run-1", status: "RUNNING" });
    const input = startTurn.mock.calls[0][0];
    expect(input).toMatchObject({
      userId: "owner",
      workspaceId: "workspace",
      sokoBotId: authorized.turn.sokoBotId,
      source: "CHAT",
      versionId: "v24",
      background: {
        parentTurnId: "parent-turn",
        title: "Gmail CRM",
        destinationRoomId: "room-owner",
      },
    });
    expect(input.message).toContain("Go through Gmail since 2023-10-13");
    expect(input.presetRoute.capabilities).toEqual([
      "search_inbox",
      "create_table",
      "write_table_rows",
      "bash",
      "list_background_runs",
    ]);
    expect(input.presetRoute.sandbox).toBe(true);
    expect(reconcileTurn).toHaveBeenCalledWith("run-1", undefined, "lease");
  });

  it("passes the admitted Preprod generation to the child turn", async () => {
    findUniqueOrThrow.mockResolvedValue(ownerParent);
    startTurn.mockResolvedValue({ turnId: "run-1", status: "RUNNING" });
    await startBackgroundRun(
      {
        ...authorized,
        provenance: { network: "preprod", expectedPreprodGeneration: 3 },
      },
      { title: "t", brief: "b" },
    );
    expect(startTurn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        network: "preprod",
        expectedPreprodGeneration: 3,
      }),
    );
  });

  it("refuses a run started from a run or from a teammate", async () => {
    findUniqueOrThrow.mockResolvedValueOnce({
      ...ownerParent,
      parentTurnId: "older",
    });
    await expect(
      startBackgroundRun(authorized, { title: "t", brief: "b" }),
    ).rejects.toThrow(/cannot start another/);
    findUniqueOrThrow.mockResolvedValueOnce({
      ...ownerParent,
      askedByUserId: "teammate",
    });
    await expect(
      startBackgroundRun(authorized, { title: "t", brief: "b" }),
    ).rejects.toThrow(/Only the owner/);
    expect(startTurn).not.toHaveBeenCalled();
  });

  describe("on a shared bot", () => {
    const shared = {
      ...authorized,
      askedByKind: "TEAMMATE",
      turn: {
        ...authorized.turn,
        actingUserId: "ada",
        requestedByUserId: "ada",
      },
      reader: {
        sharedScope: {
          sokoBotId: "bot",
          workspaceId: "workspace",
          projectId: "project",
        },
      },
    } as unknown as AuthorizedSokoBotRuntime;
    /** Ada asked the bot in a channel; the bot's own room is elsewhere. */
    const memberParent = {
      source: "CHAT",
      parentTurnId: null,
      requestedByUserId: "ada",
      askedByUserId: "ada",
      chainDepth: 0,
      destinationRoomId: "room-channel",
      sokoBot: { sharedRoomId: "room-shared" },
    };
    const start = (of: AuthorizedSokoBotRuntime = shared) =>
      startBackgroundRun(of, { title: "Outreach list", brief: "Build it." });

    beforeEach(() => {
      findFirst.mockResolvedValue(null);
      startTurn.mockResolvedValue({ turnId: "run-1", status: "RUNNING" });
    });

    it("starts the member's run, asked as them, reporting in the bot's own room", async () => {
      findUniqueOrThrow.mockResolvedValue(memberParent);

      await expect(start()).resolves.toMatchObject({ runId: "run-1" });
      const input = startTurn.mock.calls[0][0];
      expect(input).toMatchObject({
        userId: "ada",
        workspaceId: "workspace",
        sokoBotId: "bot",
        source: "CHAT",
        chat: { askedByUserId: "ada" },
        background: {
          parentTurnId: "parent-turn",
          title: "Outreach list",
          destinationRoomId: "room-shared",
        },
      });
      expect(input.presetRoute.capabilities).not.toContain(
        "start_background_run",
      );
      expect(input.message).toContain("beside the chat you were asked in");
      expect(input.message).not.toContain("owner");
    });

    it.each([
      ["the bot's own rhythm", { source: "SCHEDULE" }, {}],
      ["an event", { source: "EVENT" }, {}],
      ["another bot's message", { chainDepth: 1 }, {}],
      ["a turn asked for someone else", { askedByUserId: "bob" }, {}],
      ["an assistant", {}, { askedByKind: "ASSISTANT" }],
      [
        "a turn nobody asked for",
        { requestedByUserId: null, askedByUserId: null },
        { turn: { ...shared.turn, actingUserId: null } },
      ],
    ])("refuses a run from %s", async (_label, parent, turn) => {
      findUniqueOrThrow.mockResolvedValue({ ...memberParent, ...parent });

      await expect(
        start({ ...shared, ...turn } as AuthorizedSokoBotRuntime),
      ).rejects.toThrow("Only a member's own request in chat");
      expect(startTurn).not.toHaveBeenCalled();
    });

    it("runs one at a time", async () => {
      findUniqueOrThrow.mockResolvedValue(memberParent);
      findFirst.mockResolvedValue({
        id: "run-0",
        backgroundTitle: "Results log",
      });

      await expect(start()).rejects.toThrow(
        '"Results log" is still running (runId run-0). One background run at a time',
      );
      expect(findFirst.mock.calls[0][0].where).toMatchObject({
        sokoBotId: "bot",
        parentTurnId: { not: null },
        clientTurnId: { startsWith: "background:" },
      });
      expect(startTurn).not.toHaveBeenCalled();
    });

    it("tells the bot who may stop a run that is not this member's", async () => {
      const { HTTPException } = await import("hono/http-exception");
      findFirst.mockResolvedValue({ id: "run-1", status: "RUNNING" });
      cancelTurn.mockRejectedValueOnce(
        new HTTPException(403, {
          message:
            "Only the member who asked, or an organization owner or admin, can act on this turn",
        }),
      );

      await expect(stopBackgroundRun(shared, "run-1")).rejects.toThrow(
        "Only the member who asked, or an organization owner or admin",
      );
      expect(cancelTurn).toHaveBeenCalledWith("ada", "run-1");
    });
  });

  it("lists runs with their latest plan", async () => {
    findMany.mockResolvedValue([
      {
        id: "run-1",
        backgroundTitle: "Gmail CRM",
        status: "RUNNING",
        createdAt: new Date("2026-10-13T10:00:00Z"),
        deadlineAt: new Date("2026-10-13T16:00:00Z"),
        completedAt: null,
        finalAnswer: null,
        errorKind: null,
        _count: { toolCalls: 42 },
        toolCalls: [
          { input: { steps: [{ step: "2024 Q1", status: "in_progress" }] } },
        ],
      },
    ]);
    const { runs } = await listBackgroundRuns(authorized);
    expect(runs[0]).toMatchObject({
      runId: "run-1",
      title: "Gmail CRM",
      status: "RUNNING",
      toolCalls: 42,
      plan: [{ step: "2024 Q1", status: "in_progress" }],
    });
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      sokoBotId: "bot",
      parentTurnId: { not: null },
    });
  });

  it("stops only the bot's own runs", async () => {
    findFirst.mockResolvedValueOnce(null);
    await expect(stopBackgroundRun(authorized, "someone-else")).rejects.toThrow(
      /No background run/,
    );
    findFirst.mockResolvedValueOnce({ id: "run-1", status: "RUNNING" });
    await expect(stopBackgroundRun(authorized, "run-1")).resolves.toMatchObject(
      { stopped: true },
    );
    expect(cancelTurn).toHaveBeenCalledWith("owner", "run-1");
  });

  it("stops its own run as the bot when the turn acts for nobody", async () => {
    findFirst.mockResolvedValueOnce({ id: "run-1", status: "RUNNING" });
    await stopBackgroundRun(
      {
        ...authorized,
        turn: {
          ...authorized.turn,
          actingUserId: null,
          requestedByUserId: null,
        },
      } as never,
      "run-1",
    );
    expect(cancelTurn).toHaveBeenCalledWith({ sokoBotId: "bot" }, "run-1");
  });
});
