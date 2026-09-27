import type { SokoBotToolCall } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { ACTION_CAPABILITIES } from "./action-receipts";
import { buildActionResponse } from "./action-response";

const db = vi.hoisted(() => ({
  sokoBotToolCall: { findMany: vi.fn(), findUnique: vi.fn() },
  sokoBotTurn: { findUnique: vi.fn() },
  task: { findFirst: vi.fn() },
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

function replay() {
  return receipt({
    id: "replay-one",
    replayedReceiptId: "source-one",
    disposition: "ALREADY_SATISFIED",
    verification: "NONE",
    committedAt: null,
    targetId: null,
    operationKey: null,
  });
}

describe("authoritative action responses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.sokoBotTurn.findUnique.mockResolvedValue({
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      intentId: "intent-one",
      intentRevision: 2,
    });
  });

  it.each([true, false])(
    "checks retained archival history before a success claim: %s",
    async (historyPresent) => {
      const archived = receipt({ capability: "archive_task" });
      db.sokoBotToolCall.findMany.mockResolvedValue([archived]);
      db.sokoBotToolCall.findUnique.mockResolvedValue({
        ...archived,
        turn: { userId: "owner", workspaceId: "workspace-one" },
      });
      db.task.findFirst.mockResolvedValue(
        historyPresent ? { id: "task-one" } : null,
      );
      const result = await buildActionResponse(
        prisma,
        "turn-current",
        "Permanently deleted everything.",
      );
      expect(result.answerText).toBe(
        historyPresent
          ? "Archived task (task-one)."
          : "I could not verify archive_task.",
      );
      expect(db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: "task-one",
          ownerId: "owner",
          workspaceId: "workspace-one",
          archivedAt: { not: null },
          events: { some: { id: "event-one", sokoBotId: "bot-one" } },
        },
        select: { id: true },
      });
    },
  );

  it("renders a deterministic action claim and discards unsupported model prose", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([receipt()]);
    expect(
      await buildActionResponse(
        prisma,
        "turn-current",
        "I also hired three agents and delivered the research.",
      ),
    ).toEqual({
      appliedReceiptIds: ["receipt-one"],
      narrative: null,
      observations: [],
      unfulfilledActions: [],
      answerText: "Updated task (task-one).",
    });
    expect(db.sokoBotToolCall.findMany).toHaveBeenCalledWith({
      where: {
        turnId: "turn-current",
        capability: { in: [...ACTION_CAPABILITIES] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  });

  it("does not equate created task with fulfilled work", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({ capability: "create_task" }),
    ]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "All requested work is complete.",
    );
    expect(result.answerText).toBe("Created task (task-one).");
  });

  it.each([
    { status: "PENDING" as const },
    { status: "FAILED" as const },
    { disposition: "REJECTED" as const },
    { verification: "NONE" as const },
    { committedAt: null },
    { targetId: null },
  ])("rejects incomplete proof %j", async (change) => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([receipt(change)]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "The update succeeded.",
    );
    expect(result.appliedReceiptIds).toEqual([]);
    expect(result.answerText).toBe("I could not verify update_task.");
    expect(result.unfulfilledActions).toEqual([
      {
        action: "update_task",
        receiptId: "receipt-one",
        reason: "NOT_VERIFIED",
      },
    ]);
  });

  it("reports external uncertainty without a success claim or permission to repeat", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValueOnce([
      receipt({
        capability: "run_integration_tool",
        disposition: "UNKNOWN",
        verification: "NONE",
        committedAt: null,
      }),
    ]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "The meeting is booked. Retrying is safe.",
    );
    expect(result.appliedReceiptIds).toEqual([]);
    expect(result.answerText).toBe(
      "The outcome of run_integration_tool is unknown. Reconciliation is required before retrying.",
    );
    expect(result.unfulfilledActions[0].reason).toBe("UNKNOWN");
  });

  it("uses original committed evidence for a replay and scopes its lookup", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([replay()])
      .mockResolvedValueOnce([
        receipt({ id: "source-one", turnId: "turn-prior" }),
      ]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "I applied the update again.",
    );
    expect(result).toMatchObject({
      appliedReceiptIds: ["source-one"],
      unfulfilledActions: [],
      answerText: "Previously verified: Updated task (task-one).",
    });
    expect(db.sokoBotToolCall.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: { in: ["source-one"] },
        actorBotId: "bot-one",
        turn: {
          sokoBotId: "bot-one",
          workspaceId: "workspace-one",
          intentId: "intent-one",
          intentRevision: 2,
        },
      },
    });
  });

  it("allows only same-turn sources when no durable intent exists", async () => {
    db.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      intentId: null,
      intentRevision: null,
    });
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([replay()])
      .mockResolvedValueOnce([]);
    const result = await buildActionResponse(prisma, "turn-current", "Done.");
    expect(db.sokoBotToolCall.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: { in: ["source-one"] },
        actorBotId: "bot-one",
        turn: {
          id: "turn-current",
          sokoBotId: "bot-one",
          workspaceId: "workspace-one",
        },
      },
    });
    expect(result.appliedReceiptIds).toEqual([]);
  });

  it.each([
    { capability: "hire_agent" },
    { inputHash: "different-hash" },
    { verification: "NONE" as const },
  ])(
    "does not accept a mismatched or unverified replay source %j",
    async (change) => {
      db.sokoBotToolCall.findMany
        .mockResolvedValueOnce([replay()])
        .mockResolvedValueOnce([
          receipt({ id: "source-one", turnId: "turn-prior", ...change }),
        ]);
      const result = await buildActionResponse(prisma, "turn-current", "Done.");
      expect(result.appliedReceiptIds).toEqual([]);
      expect(result.unfulfilledActions).toEqual([
        {
          action: "update_task",
          receiptId: "replay-one",
          reason: "NOT_VERIFIED",
        },
      ]);
    },
  );

  it("deduplicates a same-turn source referenced by a replay", async () => {
    const source = receipt({ id: "source-one" });
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([source, replay()])
      .mockResolvedValueOnce([source]);
    const result = await buildActionResponse(
      prisma,
      "turn-current",
      "Done twice.",
    );
    expect(result.appliedReceiptIds).toEqual(["source-one"]);
    expect(result.unfulfilledActions).toEqual([]);
    expect(result.answerText).toBe("Updated task (task-one).");
  });

  it.each(["create_table", "write_table_rows", "update_table_columns"])(
    "reports %s only from its committed table receipt",
    async (capability) => {
      db.sokoBotToolCall.findMany.mockResolvedValue([
        receipt({ capability, targetId: "table-one" }),
      ]);
      const result = await buildActionResponse(
        prisma,
        "turn-current",
        "I emailed the table to everyone.",
      );
      expect(result.appliedReceiptIds).toHaveLength(1);
      expect(result.answerText).not.toContain("emailed");
      expect(result.answerText).toContain(
        capability === "create_table" ? "/drive/tables/table-one" : "table-one",
      );
      db.sokoBotToolCall.findMany.mockResolvedValue([
        receipt({ capability, targetId: "table-one", verification: "NONE" }),
      ]);
      const unverified = await buildActionResponse(
        prisma,
        "turn-current",
        "Created the table.",
      );
      expect(unverified.appliedReceiptIds).toEqual([]);
      expect(unverified.answerText).toBe(`I could not verify ${capability}.`);
    },
  );

  it("preserves an explicit clarification without accepting success prose", async () => {
    db.sokoBotToolCall.findMany.mockResolvedValue([]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "I changed everything",
      true,
      {
        kind: "CLARIFY",
        question: "TARGET",
        observationToolCallIds: [],
      },
    );
    expect(response.answerText).toBe("Which task or item do you mean?");
  });

  it.each(["Nothing to add.", "Nothing new worth flagging."])(
    "preserves silent proactive answers: %s",
    async (text) => {
      db.sokoBotToolCall.findMany.mockResolvedValue([]);
      expect(
        (await buildActionResponse(prisma, "turn-current", text, true))
          .answerText,
      ).toBe("Nothing to add.");
    },
  );

  it("combines receipts and persisted authorized read facts, without model facts", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([receipt()])
      .mockResolvedValueOnce([
        receipt({
          capability: "get_task_status",
          result: { name: "Launch", status: "IN_PROGRESS" },
        }),
      ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "The task finished",
      true,
      {
        kind: "REPORT",
        question: null,
        observationToolCallIds: ["read-one"],
      },
    );
    expect(response.answerText).toBe(
      'Updated task (task-one).\nObserved task "Launch": status "IN_PROGRESS".',
    );
    expect(db.sokoBotToolCall.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          turnId: "turn-current",
          toolCallId: { in: ["read-one"] },
          capability: { in: ["get_task_status", "get_job_status"] },
          status: "COMPLETED",
        },
      }),
    );
  });

  it("explains blocked work from persisted evidence alongside a verified action", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([receipt({ capability: "assign_task" })])
      .mockResolvedValueOnce([
        receipt({
          capability: "get_task_status",
          result: {
            name: "Launch campaign",
            status: "BLOCKED",
            project: { name: "Autumn launch" },
            assignee: { name: "Nina" },
            events: [
              {
                by: "coworker",
                status: "BLOCKED",
                comment: "Waiting for owner approval of the campaign budget.",
              },
            ],
            fulfillment: {
              state: "PARTIAL",
              blockerKind: "RESULT_EVIDENCE_UNAVAILABLE",
              remainingSteps: ["approval"],
              acceptanceCriteria: [
                { id: "approval", description: "Approved campaign budget" },
              ],
            },
            links: [
              {
                relation: "BLOCKS",
                direction: "to-this",
                task: { name: "Budget approval", status: "INPUT_REQUIRED" },
                note: "The owner must approve the budget.",
              },
            ],
          },
        }),
      ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "I approved the budget and completed the campaign",
      true,
      {
        kind: "REPORT",
        question: null,
        observationToolCallIds: ["read-blocked"],
      },
    );
    expect(response.answerText).toContain("Assigned task (task-one).");
    expect(response.answerText).toContain(
      'Observed task "Launch campaign": status "BLOCKED".',
    );
    expect(response.answerText).toContain('Recorded project: "Autumn launch".');
    expect(response.answerText).toContain('Recorded assignee: "Nina".');
    expect(response.answerText).toContain(
      'Latest reported task update ("coworker"): "Waiting for owner approval of the campaign budget.".',
    );
    expect(response.answerText).toContain(
      "Recorded outcome assessment: The requested outcome is partially complete. Result evidence is not yet available.",
    );
    expect(response.answerText).toContain(
      'Still unverified: "Approved campaign budget".',
    );
    expect(response.answerText).toContain(
      '"Budget approval", status "INPUT_REQUIRED"',
    );
    expect(response.answerText).not.toContain("I approved");
    expect(response.appliedReceiptIds).toEqual(["receipt-one"]);
  });

  it("reads the actual latest job-event status and explains missing input", async () => {
    db.sokoBotToolCall.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        receipt({
          capability: "get_job_status",
          result: {
            name: "Research",
            events: [
              { status: "AWAITING_INPUT", inputSchema: { type: "object" } },
            ],
          },
        }),
      ]);
    const response = await buildActionResponse(
      prisma,
      "turn-current",
      "The research is done",
      true,
      { kind: "REPORT", question: null, observationToolCallIds: ["read-job"] },
    );
    expect(response.answerText).toBe(
      'Observed job "Research": status "AWAITING_INPUT".\nThe latest job event is awaiting input; completion is not verified.',
    );
  });

  it.each([false, true])(
    "handles no action attempts with actionRequested=%s",
    async (actionRequested) => {
      db.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
      const result = await buildActionResponse(
        prisma,
        "turn-current",
        "Synthetic response",
        actionRequested,
      );
      expect(result).toEqual({
        appliedReceiptIds: [],
        narrative: null,
        observations: [],
        unfulfilledActions: [],
        answerText: actionRequested
          ? "No action was verified. Please specify the target and change you want."
          : "Synthetic response",
      });
      expect(db.sokoBotTurn.findUnique).not.toHaveBeenCalled();
    },
  );
});
