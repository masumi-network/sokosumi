import type { SokoBotToolCall } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { buildActionResponse } from "./action-response";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn() },
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  job: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));

function receipt(overrides: Partial<SokoBotToolCall> = {}): SokoBotToolCall {
  return {
    id: "receipt-one",
    turnId: "turn-current",
    toolCallId: "call-one",
    capability: "update_task",
    actorBotId: "bot-one",
    inputHash: "input-hash",
    input: {},
    result: {},
    operationKey: "operation-one",
    status: "COMPLETED",
    disposition: "APPLIED",
    verification: "LOCAL_TRANSACTION",
    targetId: "task-one",
    effectEventId: "event-one",
    observedVersion: null,
    committedAt: new Date("2026-09-26T12:00:00Z"),
    createdAt: new Date("2026-09-26T12:00:00Z"),
    updatedAt: new Date("2026-09-26T12:00:00Z"),
    errorKind: null,
    errorDetail: null,
    replayedReceiptId: null,
    ...overrides,
  };
}

describe("recovered action responses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.task.findMany.mockResolvedValue([]);
    db.sokoBotTurn.findUnique.mockResolvedValue({
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      intentId: "intent-one",
      intentRevision: 2,
    });
  });

  function refusedThenCreated(
    refused: Record<string, unknown>,
    created: Record<string, unknown> = {},
  ) {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        id: "refused",
        toolCallId: "call-refused",
        capability: "create_task",
        status: "FAILED",
        disposition: "REJECTED",
        verification: "NONE",
        committedAt: null,
        targetId: null,
        input: { name: "Brief" },
        createdAt: new Date("2026-09-26T12:00:00Z"),
        ...refused,
      }),
      receipt({
        id: "created",
        toolCallId: "call-created",
        capability: "create_task",
        input: { name: "Brief", triggeringTaskId: "task-1" },
        createdAt: new Date("2026-09-26T12:00:05Z"),
        ...created,
      }),
    ]);
  }

  it("does not contradict a Task created after removing a mistaken owner ID from projectId", async () => {
    db.sokoBotTurn.findUnique.mockResolvedValue({
      requestedByUserId: "owner-one",
    });
    const input = {
      name: "Research x402 news",
      description: "Sources from the last 30 days.",
      status: "DRAFT",
    };
    refusedThenCreated(
      {
        input: { ...input, projectId: "owner-one" },
        errorDetail: "Project not found",
      },
      { input },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toEqual([]);
    expect(response.answerText).toBe("Created task.");
  });

  it.each([
    ["project-missing", "Project not found"],
    ["owner-one", "Project access denied"],
  ])(
    "keeps a distinct Project failure visible: %s, %s",
    async (projectId, errorDetail) => {
      db.sokoBotTurn.findUnique.mockResolvedValue({
        requestedByUserId: "owner-one",
      });
      const input = {
        name: "Research x402 news",
        description: "Sources from the last 30 days.",
        status: "DRAFT",
      };
      refusedThenCreated(
        { input: { ...input, projectId }, errorDetail },
        { input },
      );
      const response = await buildActionResponse(
        prisma,
        "turn-current",
        "Done.",
      );
      expect(response.unfulfilledActions).toHaveLength(1);
      expect(response.answerText).toContain("Earlier attempt:");
    },
  );

  it("keeps a changed Task brief visible even after the owner ID is removed", async () => {
    db.sokoBotTurn.findUnique.mockResolvedValue({
      requestedByUserId: "owner-one",
    });
    const input = {
      name: "Research x402 news",
      description: "Sources from the last 30 days.",
      status: "DRAFT",
    };
    refusedThenCreated(
      {
        input: { ...input, projectId: "owner-one" },
        errorDetail: "Project not found",
      },
      { input: { ...input, description: "Research a different scope." } },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
    expect(response.answerText).toContain("Earlier attempt:");
  });

  it("does not contradict a table created after removing an invalid Task attachment", async () => {
    const input = {
      key: "research",
      title: "Hannah's findings",
      columns: [{ id: "name", name: "Name" }],
      rows: [{ values: { name: "Sokosumi" } }],
    };
    refusedThenCreated(
      {
        capability: "create_table",
        input: { ...input, taskId: "unassigned-task" },
        errorDetail: "Task is not assigned to this actor",
      },
      { capability: "create_table", input },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toEqual([]);
    expect(response.answerText).toBe(
      "Created table ([Open table](/drive/tables/task-one)).",
    );
  });

  it.each(["different content", "different key", "different failure"])(
    "keeps a distinct table failure visible: %s",
    async (difference) => {
      const input = {
        key: "research",
        title: "Hannah's findings",
        columns: [{ id: "name", name: "Name" }],
        rows: [{ values: { name: "Sokosumi" } }],
      };
      refusedThenCreated(
        {
          capability: "create_table",
          input: { ...input, taskId: "unassigned-task" },
          errorDetail:
            difference === "different failure"
              ? "Workspace access denied"
              : "Task is not assigned to this actor",
        },
        {
          capability: "create_table",
          input: {
            ...input,
            ...(difference === "different content"
              ? { rows: [{ values: { name: "Other research" } }] }
              : {}),
            ...(difference === "different key" ? { key: "other-table" } : {}),
          },
        },
      );
      const response = await buildActionResponse(
        prisma,
        "turn-current",
        "Done.",
      );
      expect(response.unfulfilledActions).toHaveLength(1);
      expect(response.answerText).toContain("Earlier attempt:");
    },
  );

  it("does not report a refused attempt the bot then made good", async () => {
    refusedThenCreated({});
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.answerText).toBe("Created task.");
    expect(response.unfulfilledActions).toEqual([]);
  });

  it("does not report a file refused for its name, then made under another", async () => {
    const voiceover = { text: "Sonntag im Haus Hiltl", folder: "Video" };
    refusedThenCreated(
      {
        capability: "generate_voiceover",
        input: { ...voiceover, filename: "stimme.mp3" },
      },
      {
        capability: "generate_voiceover",
        input: { ...voiceover, filename: "stimme-final.mp3" },
      },
    );
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toEqual([]);
    expect(response.answerText).not.toContain("Not confirmed");
  });

  it("still reports a refused attempt a different call followed", async () => {
    refusedThenCreated({ input: { name: "Launch plan" } });
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.unfulfilledActions).toHaveLength(1);
  });

  it("always reports an attempt whose outcome is unknown", async () => {
    refusedThenCreated({ status: "COMPLETED", disposition: "UNKNOWN" });
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.answerText).toContain(
      "I couldn't confirm whether this went through: created task.",
    );
  });

  it("still reports a refused attempt nothing replaced", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "create_task",
        status: "FAILED",
        disposition: "REJECTED",
        verification: "NONE",
        committedAt: null,
        targetId: null,
      }),
    ]);
    const response = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(response.answerText).toBe("Couldn't create a Task.");
  });
});
