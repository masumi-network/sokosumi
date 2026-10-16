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
  askedByUserId: null,
  chainDepth: 0,
  destinationRoomId: "room-owner",
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

  it("refuses a shared bot with a reason of its own", async () => {
    const shared = {
      ...authorized,
      reader: {
        sharedScope: {
          sokoBotId: "bot",
          workspaceId: "workspace",
          projectId: null,
        },
      },
    } as unknown as AuthorizedSokoBotRuntime;
    await expect(
      startBackgroundRun(shared, { title: "t", brief: "b" }),
    ).rejects.toThrow("A shared Soko Bot cannot start background runs");
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
    expect(startTurn).not.toHaveBeenCalled();
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
});
