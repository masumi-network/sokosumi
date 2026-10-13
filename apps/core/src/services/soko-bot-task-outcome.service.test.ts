import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { readSokoBotTaskOutcome } from "./soko-bot-task-outcome.service";

const dbMock = vi.hoisted(() => ({
  sokoBotTurn: { findFirst: vi.fn() },
  sokoBotToolCall: { findMany: vi.fn() },
  task: { findFirst: vi.fn() },
  sokoBotIntentOutcome: { findFirst: vi.fn() },
}));
vi.mock("@/lib/db/prisma", () => ({ default: dbMock }));

const criteria = [
  {
    kind: "ACTION",
    id: "schedule-configured",
    capability: "create_schedule",
    targetId: "schedule-one",
  },
];

describe("scoped task outcome reads", () => {
  const input = {
    turnId: "turn-current",
    sokoBotId: "bot-one",
    workspaceId: "workspace-one",
    userId: "owner-one",
    intentId: "intent-one",
    intentRevision: 2,
    audience: "OWNER" as const,
    taskId: "task-one",
  };
  const taskTime = new Date("2026-09-26T12:00:00Z");
  const assessmentTime = new Date("2026-09-26T13:00:00Z");
  const intent = {
    id: "intent-one",
    sokoBotId: "bot-one",
    workspaceId: "workspace-one",
    requesterId: "owner-one",
    roomId: "room-one",
    revision: 2,
    state: "IN_PROGRESS",
    targetIds: ["task-one"],
    acceptanceCriteria: criteria,
  };
  const currentTurn = {
    intent,
    sokoBot: { userId: "owner-one" },
    contextSnapshot: { packet: { trigger: { askedBy: { kind: "OWNER" } } } },
    chatMention: { message: { roomId: "room-one" } },
  };
  const outcome = {
    state: "FULFILLED",
    criteriaResults: [
      { id: "schedule-configured", satisfied: true, evidenceId: "receipt-one" },
    ],
    evidenceIds: ["receipt-one"],
    remainingSteps: [],
    blockerKind: null,
    evidenceRevision: "revision-one",
    assessedAt: assessmentTime,
  };
  beforeEach(() => {
    vi.resetAllMocks();
    dbMock.sokoBotTurn.findFirst.mockResolvedValue(currentTurn);
    dbMock.task.findFirst.mockResolvedValue({
      updatedAt: taskTime,
      events: [{ id: "event-one", createdAt: taskTime, updatedAt: taskTime }],
    });
    dbMock.sokoBotIntentOutcome.findFirst.mockResolvedValue(outcome);
    dbMock.sokoBotToolCall.findMany.mockResolvedValue([
      {
        targetId: "task-one",
        effectEventId: "event-one",
        committedAt: taskTime,
      },
    ]);
  });

  it("returns acceptance criteria, blockers, evidence revision and remaining steps within exact authorization scope", async () => {
    expect(await readSokoBotTaskOutcome(prisma, input)).toEqual({
      ...outcome,
      assessedAt: assessmentTime.toISOString(),
      acceptanceCriteria: criteria,
    });
    expect(dbMock.sokoBotTurn.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "turn-current",
          sokoBotId: "bot-one",
          workspaceId: "workspace-one",
          userId: "owner-one",
          intentId: "intent-one",
          intentRevision: 2,
          chainDepth: 0,
          OR: [{ requestedByUserId: null }, { requestedByUserId: "owner-one" }],
        },
      }),
    );
    expect(dbMock.sokoBotIntentOutcome.findFirst).toHaveBeenCalledWith({
      where: { intentId: "intent-one", intentRevision: 2 },
      orderBy: [{ assessedAt: "desc" }, { id: "desc" }],
    });
    expect(dbMock.task.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "task-one",
          workspaceId: "workspace-one",
          archivedAt: null,
          OR: [
            { visibility: "PUBLIC" },
            { visibility: "PRIVATE", ownerId: "owner-one" },
          ],
        },
      }),
    );
  });

  it.each(["TEAMMATE", "ASSISTANT", undefined] as const)(
    "does not load owner assessments for audience %s",
    async (audience) => {
      expect(
        await readSokoBotTaskOutcome(prisma, { ...input, audience }),
      ).toMatchObject({
        state: "UNKNOWN",
        acceptanceCriteria: [],
        criteriaResults: [],
        evidenceRevision: null,
      });
      expect(dbMock.sokoBotTurn.findFirst).not.toHaveBeenCalled();
    },
  );

  it.each([
    { sokoBotId: "other-bot" },
    { workspaceId: "other-workspace" },
    { requesterId: "teammate" },
    { revision: 3 },
    { roomId: "other-room" },
    { targetIds: ["other-task"] },
  ])("does not expose criteria for mismatched intent %j", async (change) => {
    dbMock.sokoBotTurn.findFirst.mockResolvedValueOnce({
      ...currentTurn,
      intent: { ...intent, ...change },
    });
    expect(await readSokoBotTaskOutcome(prisma, input)).toMatchObject({
      state: "UNKNOWN",
      acceptanceCriteria: [],
      evidenceIds: [],
    });
    expect(dbMock.sokoBotIntentOutcome.findFirst).not.toHaveBeenCalled();
  });

  it("rechecks persisted audience and refuses stale caller assertions", async () => {
    dbMock.sokoBotTurn.findFirst.mockResolvedValueOnce({
      ...currentTurn,
      contextSnapshot: {
        packet: { trigger: { askedBy: { kind: "TEAMMATE" } } },
      },
    });
    expect((await readSokoBotTaskOutcome(prisma, input)).state).toBe("UNKNOWN");
    expect(dbMock.task.findFirst).not.toHaveBeenCalled();
  });

  it.each(["2026-09-26T12:30:00Z", "2026-09-26T14:00:00Z"])(
    "rejects newer task evidence even when assessment ran afterward: %s",
    async (at) => {
      dbMock.task.findFirst.mockResolvedValueOnce({
        updatedAt: new Date(at),
        events: [
          {
            id: "contradictory-event",
            createdAt: new Date(at),
            updatedAt: new Date(at),
          },
        ],
      });
      expect(await readSokoBotTaskOutcome(prisma, input)).toMatchObject({
        state: "UNKNOWN",
        blockerKind: "EVIDENCE_CHANGED",
        criteriaResults: [],
        evidenceIds: [],
        evidenceRevision: null,
        remainingSteps: ["schedule-configured"],
      });
    },
  );

  it("does not report fulfillment when committed proof disappeared", async () => {
    dbMock.sokoBotToolCall.findMany.mockResolvedValueOnce([]);
    expect((await readSokoBotTaskOutcome(prisma, input)).state).toBe("UNKNOWN");
  });

  it("returns a current partial assessment without promoting it from task completion", async () => {
    dbMock.sokoBotIntentOutcome.findFirst.mockResolvedValueOnce({
      ...outcome,
      state: "PARTIAL",
      blockerKind: "OUTCOME_SCOPE_REQUIRES_REVIEW",
      remainingSteps: ["research-scope"],
    });
    expect(await readSokoBotTaskOutcome(prisma, input)).toMatchObject({
      state: "PARTIAL",
      blockerKind: "OUTCOME_SCOPE_REQUIRES_REVIEW",
      remainingSteps: ["research-scope"],
      evidenceRevision: "revision-one",
    });
  });

  it("returns no assessment for inaccessible tasks or an absent current turn", async () => {
    dbMock.task.findFirst.mockResolvedValueOnce(null);
    expect((await readSokoBotTaskOutcome(prisma, input)).state).toBe("UNKNOWN");
    expect(dbMock.sokoBotIntentOutcome.findFirst).not.toHaveBeenCalled();
    dbMock.sokoBotTurn.findFirst.mockResolvedValueOnce(null);
    expect((await readSokoBotTaskOutcome(prisma, input)).state).toBe("UNKNOWN");
  });
  it("never loads an owner assessment for a shared bot's turn", async () => {
    // A shared bot has no owner: an OWNER packet must not open this read.
    dbMock.sokoBotTurn.findFirst.mockResolvedValueOnce({
      ...currentTurn,
      sokoBot: { userId: null },
    });
    expect((await readSokoBotTaskOutcome(prisma, input)).state).toBe("UNKNOWN");
    expect(dbMock.task.findFirst).not.toHaveBeenCalled();
    expect(dbMock.sokoBotTurn.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          sokoBot: { select: { userId: true } },
        }),
      }),
    );
  });
});
