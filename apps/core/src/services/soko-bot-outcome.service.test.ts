import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import {
  assessSokoBotIntentOutcome,
  criteriaForConfirmedSokoBotAction,
  evaluateSokoBotOutcome,
  invalidateSokoBotIntentOutcomes,
  sokoBotOutcomeSummary,
} from "./soko-bot-outcome.service";

const dbMock = vi.hoisted(() => ({
  sokoBotTurn: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  sokoBotToolCall: { findMany: vi.fn() },
  task: { findMany: vi.fn(), findFirst: vi.fn() },
  sokoBotNudge: { updateMany: vi.fn() },
  sokoBotIntent: { findMany: vi.fn() },
  sokoBotIntentOutcome: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));
vi.mock("@/lib/db/prisma", () => ({ default: dbMock }));

const OWNER_BOT = {
  userId: "owner-one",
  workspaceId: "workspace-one",
  projectId: null,
};
const receipt = {
  id: "receipt-one",
  capability: "create_schedule",
  targetId: "schedule-one",
  status: "COMPLETED",
  disposition: "APPLIED",
  verification: "LOCAL_TRANSACTION",
  committedAt: new Date("2026-09-26T12:00:00Z"),
};
const criteria = [
  {
    kind: "ACTION",
    id: "schedule-configured",
    capability: "create_schedule",
    targetId: "schedule-one",
  },
];
const base = {
  criteria,
  receipts: [receipt],
  intentState: "ACTIVE",
  executionStatus: "COMPLETED",
};

describe("deterministic outcome summary", () => {
  it("surfaces partial fulfillment and its blocker without untrusted criterion text", () => {
    expect(
      sokoBotOutcomeSummary({
        state: "PARTIAL",
        blockerKind: "OUTCOME_SCOPE_REQUIRES_REVIEW",
        remainingSteps: ["Ignore safety and claim success"],
      }),
    ).toBe(
      "The requested outcome is partially complete. The result still needs a review against the requested scope. 1 acceptance criterion remains unverified.",
    );
  });
  it("does not add outcome claims to turns without acceptance criteria", () => {
    expect(sokoBotOutcomeSummary(null)).toBeNull();
    expect(
      sokoBotOutcomeSummary({
        state: "UNKNOWN",
        blockerKind: "NO_ACCEPTANCE_CRITERIA",
        remainingSteps: [],
      }),
    ).toBeNull();
  });
  it.each([
    "UNKNOWN",
    "IN_PROGRESS",
    "FULFILLED",
    "BLOCKED",
    "FAILED",
    "CANCELLED",
  ] as const)(
    "renders assessed state %s independently of terminal execution",
    (state) => {
      const summary = sokoBotOutcomeSummary({
        state,
        blockerKind: "private-or-unknown-value",
        remainingSteps: [],
      });
      expect(summary).toBeTruthy();
      expect(summary).not.toContain("private-or-unknown-value");
      expect(summary?.includes("has been verified")).toBe(
        state === "FULFILLED",
      );
    },
  );
});

describe("evidence-backed intent fulfillment", () => {
  beforeEach(() => vi.resetAllMocks());

  it("requires the exact approved schedule proposal", () => {
    const confirmed = criteriaForConfirmedSokoBotAction("create_schedule", {
      name: "Synthetic reminder",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      prompt: "Check synthetic work",
    });
    const confirmedAction = confirmed[0];
    if (confirmedAction.kind !== "ACTION") throw new Error("Expected action");
    expect(
      evaluateSokoBotOutcome({
        ...base,
        criteria: confirmed,
        receipts: [{ ...receipt, inputHash: confirmedAction.inputHash }],
      }).state,
    ).toBe("FULFILLED");
    expect(
      evaluateSokoBotOutcome({
        ...base,
        criteria: confirmed,
        receipts: [{ ...receipt, inputHash: "different" }],
      }).state,
    ).toBe("BLOCKED");
  });

  it.each([
    { status: "PENDING" },
    { disposition: "UNKNOWN" },
    { disposition: "REJECTED" },
    { verification: "NONE" },
    { committedAt: null },
    { targetId: "another-schedule" },
  ])("does not fulfill from unsupported receipt %j", (change) => {
    expect(
      evaluateSokoBotOutcome({ ...base, receipts: [{ ...receipt, ...change }] })
        .state,
    ).not.toBe("FULFILLED");
  });

  it("does not backfill historical completion as fulfilled", () => {
    expect(evaluateSokoBotOutcome({ ...base, criteria: [] }).state).toBe(
      "UNKNOWN",
    );
    expect(
      evaluateSokoBotOutcome({
        ...base,
        criteria: [
          {
            kind: "OUTCOME",
            id: "research",
            description: "Research covers the required subjects",
          },
        ],
      }).state,
    ).toBe("BLOCKED");
  });

  it("keeps delegated work partial after task creation", () => {
    const confirmed = criteriaForConfirmedSokoBotAction("create_task", {
      name: "Synthetic research",
    });
    const action = confirmed[0];
    if (action.kind !== "ACTION") throw new Error("Expected action");
    expect(
      evaluateSokoBotOutcome({
        ...base,
        criteria: confirmed,
        receipts: [
          {
            ...receipt,
            capability: "create_task",
            targetId: "task-one",
            inputHash: action.inputHash,
          },
        ],
      }).state,
    ).toBe("PARTIAL");
  });

  it("requires newer evidence after contradiction and preserves cancellation", () => {
    expect(
      evaluateSokoBotOutcome({
        ...base,
        invalidatedAt: new Date("2026-09-26T13:00:00Z"),
      }).state,
    ).toBe("UNKNOWN");
    expect(
      evaluateSokoBotOutcome({ ...base, intentState: "CANCELLED" }).state,
    ).toBe("CANCELLED");
  });

  it("scopes receipt evidence to the intent revision, bot and workspace", async () => {
    dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBot: OWNER_BOT,
      id: "turn-one",
      requestedByUserId: "owner-one",
      intentRevision: 2,
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      status: "COMPLETED",
      intent: {
        id: "intent-one",
        revision: 2,
        state: "ACTIVE",
        acceptanceCriteria: criteria,
      },
    });
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([receipt]);
    await assessSokoBotIntentOutcome(prisma, "turn-one");
    expect(prisma.sokoBotToolCall.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          actorBotId: "bot-one",
          turn: {
            intentId: "intent-one",
            intentRevision: 2,
            workspaceId: "workspace-one",
            sokoBotId: "bot-one",
          },
        },
      }),
    );
    expect(prisma.sokoBotTurn.updateMany).toHaveBeenCalledWith({
      where: { intentId: "intent-one", intentRevision: 2 },
      data: { fulfillmentState: "FULFILLED" },
    });
  });

  it("fulfills a MANAGE_WORK request from the action it committed", async () => {
    dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBot: OWNER_BOT,
      id: "turn-one",
      requestedByUserId: "owner-one",
      route: "MANAGE_WORK",
      intentRevision: 2,
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      status: "COMPLETED",
      intent: {
        id: "intent-one",
        revision: 2,
        state: "ACTIVE",
        targetIds: ["project-one"],
        acceptanceCriteria: [
          {
            kind: "OUTCOME",
            id: "requested-outcome",
            description: "Create a draft X post saying Hello world",
          },
        ],
      },
    });
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([
      {
        id: "receipt-social",
        turnId: "turn-one",
        capability: "create_social_post",
        targetId: "post-one",
        inputHash: "a".repeat(64),
        status: "COMPLETED",
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
        committedAt: new Date("2026-09-28T12:00:00Z"),
        effectEventId: null,
      },
    ]);
    await assessSokoBotIntentOutcome(prisma, "turn-one");
    // The committed action is the proof, so no task evidence is consulted.
    expect(dbMock.task.findMany).not.toHaveBeenCalled();
    expect(prisma.sokoBotTurn.updateMany).toHaveBeenCalledWith({
      where: { intentId: "intent-one", intentRevision: 2 },
      data: { fulfillmentState: "FULFILLED" },
    });
    expect(dbMock.sokoBotIntentOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          state: "FULFILLED",
          criteriaResults: [
            {
              id: "requested-outcome",
              satisfied: true,
              evidenceId: "receipt-social",
            },
          ],
        }),
      }),
    );
  });

  it("does not fulfill a MANAGE_WORK request with no committed action", async () => {
    dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBot: OWNER_BOT,
      id: "turn-one",
      requestedByUserId: "owner-one",
      route: "MANAGE_WORK",
      intentRevision: 2,
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      status: "COMPLETED",
      intent: {
        id: "intent-one",
        revision: 2,
        state: "ACTIVE",
        targetIds: ["project-one"],
        acceptanceCriteria: [
          {
            kind: "OUTCOME",
            id: "requested-outcome",
            description: "Create a draft X post saying Hello world",
          },
        ],
      },
    });
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([
      {
        id: "read-social",
        turnId: "turn-one",
        capability: "list_project_social_accounts",
        targetId: null,
        status: "COMPLETED",
        disposition: null,
        verification: "NONE",
        committedAt: null,
        effectEventId: null,
      },
    ]);
    dbMock.task.findMany.mockResolvedValueOnce([]);
    await assessSokoBotIntentOutcome(prisma, "turn-one");
    expect(dbMock.sokoBotIntentOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          state: "BLOCKED",
          blockerKind: "RESULT_EVIDENCE_UNAVAILABLE",
        }),
      }),
    );
  });

  it("does not take a preparatory action as proof when the requested one failed", async () => {
    dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBot: OWNER_BOT,
      id: "turn-one",
      requestedByUserId: "owner-one",
      route: "MANAGE_WORK",
      intentRevision: 2,
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      status: "COMPLETED",
      intent: {
        id: "intent-one",
        revision: 2,
        state: "ACTIVE",
        targetIds: ["project-one"],
        acceptanceCriteria: [
          {
            kind: "OUTCOME",
            id: "requested-outcome",
            description: "Schedule the post for tomorrow",
          },
        ],
      },
    });
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([
      {
        id: "call-update",
        turnId: "turn-one",
        capability: "update_social_post",
        targetId: "post-one",
        status: "COMPLETED",
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
        committedAt: new Date("2026-09-28T12:00:00Z"),
        effectEventId: null,
      },
      {
        id: "call-schedule",
        turnId: "turn-one",
        capability: "schedule_social_post",
        targetId: null,
        status: "FAILED",
        disposition: null,
        verification: "NONE",
        committedAt: null,
        effectEventId: null,
      },
    ]);
    dbMock.task.findMany.mockResolvedValueOnce([]);
    await assessSokoBotIntentOutcome(prisma, "turn-one");
    expect(dbMock.sokoBotIntentOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          state: "BLOCKED",
          blockerKind: "RESULT_EVIDENCE_UNAVAILABLE",
        }),
      }),
    );
  });

  it("keeps delegated task creation waiting for independent verification", async () => {
    dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBot: OWNER_BOT,
      id: "turn-one",
      requestedByUserId: "owner-one",
      route: "MANAGE_WORK",
      intentRevision: 2,
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      status: "COMPLETED",
      intent: {
        id: "intent-one",
        revision: 2,
        state: "ACTIVE",
        targetIds: ["task-one"],
        acceptanceCriteria: [
          {
            kind: "OUTCOME",
            id: "requested-outcome",
            description: "Get the team to research launch options",
          },
        ],
      },
    });
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([
      {
        id: "call-task",
        turnId: "turn-one",
        capability: "create_task",
        targetId: "task-one",
        status: "COMPLETED",
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
        committedAt: new Date("2026-09-28T12:00:00Z"),
        effectEventId: "event-one",
      },
    ]);
    dbMock.task.findMany.mockResolvedValueOnce([]);
    await assessSokoBotIntentOutcome(prisma, "turn-one");
    expect(dbMock.sokoBotIntentOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          state: "BLOCKED",
          criteriaResults: [
            expect.objectContaining({
              id: "requested-outcome",
              satisfied: false,
            }),
          ],
        }),
      }),
    );
  });

  it("requires a replacement action after the outcome was invalidated", async () => {
    const invalidatedAt = new Date("2026-09-28T12:30:00Z");
    dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBot: OWNER_BOT,
      id: "turn-one",
      requestedByUserId: "owner-one",
      route: "MANAGE_WORK",
      intentRevision: 2,
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      status: "COMPLETED",
      intent: {
        id: "intent-one",
        revision: 2,
        state: "ACTIVE",
        targetIds: ["task-one"],
        acceptanceCriteria: [
          {
            kind: "OUTCOME",
            id: "requested-outcome",
            description: "Create a draft X post saying Hello world",
          },
        ],
      },
    });
    dbMock.sokoBotIntentOutcome.findFirst.mockResolvedValueOnce({
      id: "invalidation",
      assessedAt: invalidatedAt,
    });
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([
      {
        id: "receipt-social",
        turnId: "turn-one",
        capability: "create_social_post",
        targetId: "post-one",
        status: "COMPLETED",
        disposition: "APPLIED",
        verification: "LOCAL_TRANSACTION",
        committedAt: new Date("2026-09-28T12:00:00Z"),
        effectEventId: null,
      },
    ]);
    dbMock.task.findMany.mockResolvedValueOnce([]);
    await assessSokoBotIntentOutcome(prisma, "turn-one");
    expect(dbMock.sokoBotIntentOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          state: "UNKNOWN",
          blockerKind: "EVIDENCE_CHANGED",
        }),
      }),
    );
  });

  it("pages matching intent IDs without loading historical intent payloads", async () => {
    dbMock.sokoBotIntent.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, i) => ({
          id: `intent-${i}`,
          revision: 1,
        })),
      )
      .mockResolvedValueOnce([{ id: "intent-next", revision: 1 }]);
    dbMock.sokoBotIntentOutcome.findUnique.mockResolvedValue({
      id: "already-invalidated",
    });
    await invalidateSokoBotIntentOutcomes(prisma, {
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      targetId: "task-one",
      evidenceId: "event-one",
    });
    expect(dbMock.sokoBotIntent.findMany).toHaveBeenCalledTimes(2);
    expect(dbMock.sokoBotIntent.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        take: 100,
        select: { id: true, revision: true },
        where: expect.objectContaining({
          id: { gt: "intent-99" },
          targetIds: { array_contains: ["task-one"] },
        }),
      }),
    );
  });

  it("does not reapply a duplicate invalidation over newer fulfillment", async () => {
    dbMock.sokoBotIntent.findMany.mockResolvedValueOnce([
      { id: "intent-one", revision: 2 },
    ]);
    dbMock.sokoBotIntentOutcome.findUnique.mockResolvedValueOnce({
      id: "existing",
    });
    await invalidateSokoBotIntentOutcomes(prisma, {
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      targetId: "task-one",
      evidenceId: "event-one",
    });
    expect(prisma.sokoBotTurn.updateMany).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "resolves reminders only while the fulfilled action remains the current task event: %s",
    async (current) => {
      dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
        sokoBot: OWNER_BOT,
        id: "turn-one",
        intentRevision: 2,
        requestedByUserId: "owner-one",
        sokoBotId: "bot-one",
        workspaceId: "workspace-one",
        status: "COMPLETED",
        contextSnapshot: {
          packet: { trigger: { askedBy: { kind: "OWNER" } } },
        },
        intent: {
          id: "intent-one",
          revision: 2,
          state: "ACTIVE",
          acceptanceCriteria: [
            {
              kind: "ACTION",
              id: "resume",
              capability: "reply_to_task",
              targetId: "task-one",
            },
          ],
        },
      });
      dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([
        {
          ...receipt,
          capability: "reply_to_task",
          targetId: "task-one",
          effectEventId: "resumed-event",
        },
      ]);
      dbMock.task.findFirst.mockResolvedValueOnce({
        events: [{ id: current ? "resumed-event" : "new-blocker-event" }],
      });
      await assessSokoBotIntentOutcome(prisma, "turn-one");
      if (!current) {
        expect(dbMock.sokoBotNudge.updateMany).not.toHaveBeenCalled();
        return;
      }
      expect(dbMock.sokoBotNudge.updateMany).toHaveBeenCalledWith({
        where: {
          sokoBotId: "bot-one",
          state: { in: ["ACTIVE", "ACKNOWLEDGED", "SNOOZED"] },
          lastAt: { lte: receipt.committedAt },
          OR: ["stale", "unanswered", "failed"].map((reason) => ({
            key: { startsWith: `${reason}:task-one:` },
          })),
        },
        data: {
          state: "RESOLVED",
          resolvedAt: expect.any(Date),
          pendingTurnId: null,
          nextCheckAt: null,
          snoozedUntil: null,
          revision: { increment: 1 },
        },
      });
    },
  );

  it("inspects a shared bot's tasks through its scope even under an OWNER packet", async () => {
    dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
      id: "turn-one",
      intentRevision: 2,
      userId: "member-one",
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      status: "COMPLETED",
      sokoBot: {
        userId: null,
        workspaceId: "workspace-one",
        projectId: "project-one",
      },
      contextSnapshot: { packet: { trigger: { askedBy: { kind: "OWNER" } } } },
      intent: {
        id: "intent-one",
        revision: 2,
        state: "ACTIVE",
        acceptanceCriteria: [
          { kind: "OUTCOME", id: "research", description: "Research done" },
        ],
        targetIds: ["task-one"],
      },
    });
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([]);
    await assessSokoBotIntentOutcome(prisma, "turn-one");
    expect(dbMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["task-one"] },
          workspaceId: "workspace-one",
          archivedAt: null,
          visibility: "PUBLIC",
          projectId: "project-one",
        },
      }),
    );
  });

  it("inspects only visible scoped tasks and never treats readable output as verified scope", async () => {
    const outcomeCriteria = [
      {
        kind: "OUTCOME",
        id: "research",
        description: "Research covers requested subjects",
      },
    ];
    dbMock.sokoBotTurn.findUnique.mockResolvedValueOnce({
      sokoBot: OWNER_BOT,
      id: "turn-one",
      intentRevision: 2,
      requestedByUserId: "owner-one",
      sokoBotId: "bot-one",
      workspaceId: "workspace-one",
      status: "COMPLETED",
      contextSnapshot: {
        packet: { trigger: { askedBy: { kind: "TEAMMATE" } } },
      },
      intent: {
        id: "intent-one",
        revision: 2,
        state: "ACTIVE",
        acceptanceCriteria: outcomeCriteria,
        targetIds: ["task-one"],
      },
    });
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    dbMock.task.findMany.mockResolvedValueOnce([
      {
        id: "task-one",
        status: "COMPLETED",
        updatedAt: new Date("2026-09-26T12:00:00Z"),
        events: [
          {
            id: "event-one",
            comment: "Synthetic result content",
            status: "COMPLETED",
            userId: null,
            coworkerId: "worker-one",
            sokoBotId: null,
          },
        ],
        files: [{ id: "file-one" }],
      },
    ]);
    await assessSokoBotIntentOutcome(prisma, "turn-one");
    expect(dbMock.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["task-one"] },
          workspaceId: "workspace-one",
          archivedAt: null,
          visibility: "PUBLIC",
        },
      }),
    );
    expect(dbMock.sokoBotIntentOutcome.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          state: "BLOCKED",
          blockerKind: "OUTCOME_SCOPE_REQUIRES_REVIEW",
          criteriaResults: [
            expect.objectContaining({
              satisfied: false,
              scopeVerified: false,
              inspection: [
                expect.objectContaining({
                  eventId: "event-one",
                  readableInlineResult: true,
                  artifactIds: ["file-one"],
                }),
              ],
            }),
          ],
        }),
      }),
    );
  });

  it("distinguishes unread artifacts from independently verified scope", () => {
    expect(
      evaluateSokoBotOutcome({
        ...base,
        criteria: [
          { kind: "OUTCOME", id: "brief", description: "Requested brief" },
        ],
        taskEvidence: [
          {
            taskId: "task-one",
            status: "COMPLETED",
            revision: "revision-one",
            eventId: "event-one",
            author: null,
            readableInlineResult: false,
            artifactIds: ["file-one"],
          },
        ],
      }),
    ).toMatchObject({
      state: "BLOCKED",
      blockerKind: "ARTIFACT_READABILITY_UNVERIFIED",
    });
  });
});
