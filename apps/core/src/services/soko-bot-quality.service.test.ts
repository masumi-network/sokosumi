import type { SokoBotTurnSource } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { turnFindManyMock, receiptFindManyMock } = vi.hoisted(() => ({
  turnFindManyMock: vi.fn(),
  receiptFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findMany: turnFindManyMock },
    sokoBotToolCall: { findMany: receiptFindManyMock },
  },
}));

import { getSokoBotQualityOverview } from "@/services/soko-bot-quality.service";

interface QualityTurn {
  id: string;
  workspaceId: string;
  intentId: string | null;
  intentRevision: number;
  fulfillmentState: string;
  deliveries: { status: string }[];
  responseContract: { appliedReceiptIds: string[] } | null;
  toolCalls: {
    id: string;
    status: string;
    disposition: string;
    verification: string;
    committedAt: Date;
    targetId: string;
    replayedReceiptId?: string;
    capability?: string;
    inputHash?: string;
  }[];
  createdAt: Date;
  finalAnswer: string | null;
  ownerFeedback: number | null;
  ownerFeedbackAt: Date | null;
  qualityScore: number | null;
  sokoBotId: string;
  source: SokoBotTurnSource;
  versionId: string | null;
}

function turn(overrides: Partial<QualityTurn>): QualityTurn {
  return {
    id: "turn-current",
    workspaceId: "workspace-one",
    intentId: "intent-one",
    intentRevision: 1,
    fulfillmentState: "UNKNOWN",
    deliveries: [{ status: "PUBLISHED" }],
    responseContract: null,
    toolCalls: [],
    createdAt: new Date("2026-08-25T09:00:00.000Z"),
    finalAnswer: "I completed the requested work.",
    ownerFeedback: null,
    ownerFeedbackAt: null,
    qualityScore: 4,
    sokoBotId: "bot-1",
    source: "SCHEDULE",
    versionId: "test-v1",
    ...overrides,
  };
}

describe("getSokoBotQualityOverview", () => {
  it.each(["intent-one", "other-intent"])(
    "validates replay source scope: %s",
    async (intentId) => {
      const call = {
        id: "replay-one",
        status: "COMPLETED",
        disposition: "ALREADY_SATISFIED",
        verification: "NONE",
        committedAt: new Date(),
        targetId: "",
        replayedReceiptId: "10000000-0000-4000-8000-000000000001",
        capability: "update_task",
        inputHash: "hash-one",
      };
      turnFindManyMock.mockResolvedValue([
        turn({
          toolCalls: [call],
          responseContract: {
            appliedReceiptIds: ["10000000-0000-4000-8000-000000000001"],
          },
        }),
      ]);
      receiptFindManyMock.mockResolvedValueOnce([
        {
          id: "10000000-0000-4000-8000-000000000001",
          actorBotId: "bot-1",
          capability: "update_task",
          inputHash: "hash-one",
          turn: {
            id: "turn-before",
            sokoBotId: "bot-1",
            workspaceId: "workspace-one",
            intentId,
            intentRevision: 1,
          },
        },
      ]);
      receiptFindManyMock.mockResolvedValueOnce([call]);
      const quality = await getSokoBotQualityOverview();
      expect(quality.reliability.invalidActionClaims).toBe(
        intentId === "intent-one" ? 0 : 1,
      );
    },
  );
  beforeEach(() => {
    vi.clearAllMocks();
    receiptFindManyMock.mockReset().mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("groups distinct owner feedback counts by the day the feedback was given", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        ownerFeedback: 1,
        ownerFeedbackAt: new Date("2026-08-26T08:00:00.000Z"),
      }),
      turn({
        createdAt: new Date("2026-08-26T10:00:00.000Z"),
        ownerFeedback: -1,
        ownerFeedbackAt: new Date("2026-08-27T08:00:00.000Z"),
      }),
    ]);

    const quality = await getSokoBotQualityOverview();

    expect(
      quality.daily.find((day) => day.date === "2026-08-26"),
    ).toMatchObject({
      thumbsUp: 1,
      thumbsDown: 0,
    });
    expect(
      quality.daily.find((day) => day.date === "2026-08-27"),
    ).toMatchObject({
      thumbsUp: 0,
      thumbsDown: 1,
    });
  });

  it("separates delivery, fulfillment and unsupported receipt claims", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        fulfillmentState: "IN_PROGRESS",
        deliveries: [{ status: "PERSISTED" }],
      }),
      turn({
        fulfillmentState: "BLOCKED",
        deliveries: [{ status: "DEAD_LETTER" }],
        responseContract: { appliedReceiptIds: ["missing-receipt"] },
      }),
      turn({ deliveries: [] }),
    ]);
    const quality = await getSokoBotQualityOverview();
    expect(quality.reliability).toEqual({
      fulfillment: { IN_PROGRESS: 1, BLOCKED: 1, UNKNOWN: 1 },
      delivery: { PERSISTED: 1, DEAD_LETTER: 1, UNTRACKED: 1 },
      invalidActionClaims: 1,
    });
    expect(quality.proactive.sent).toBe(1);
  });

  it("queries only real turns", async () => {
    turnFindManyMock.mockResolvedValue([]);

    await getSokoBotQualityOverview();

    expect(turnFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { clientTurnId: { startsWith: "lab:" } },
        }),
      }),
    );
  });

  it("includes recent feedback from older turns without changing headline turn counts", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        createdAt: new Date("2026-07-01T09:00:00.000Z"),
        ownerFeedback: -1,
        ownerFeedbackAt: new Date("2026-08-27T08:00:00.000Z"),
      }),
    ]);

    const quality = await getSokoBotQualityOverview();

    expect(turnFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { createdAt: { gte: new Date("2026-07-28T12:00:00.000Z") } },
            {
              ownerFeedbackAt: {
                gte: new Date("2026-07-28T12:00:00.000Z"),
              },
            },
          ],
        }),
      }),
    );
    expect(quality.overall.turns).toBe(0);
    expect(
      quality.daily.find((day) => day.date === "2026-08-27"),
    ).toMatchObject({ thumbsDown: 1 });
  });

  it("scopes panel metrics to one version while preserving fleet version rows", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        ownerFeedback: 1,
        ownerFeedbackAt: new Date("2026-08-26T08:00:00.000Z"),
        qualityScore: 4,
      }),
      turn({
        createdAt: new Date("2026-08-27T08:00:00.000Z"),
        finalAnswer: "Thanks",
        qualityScore: 2,
        source: "CHAT",
      }),
      turn({
        createdAt: new Date("2026-08-27T09:00:00.000Z"),
        ownerFeedback: -1,
        ownerFeedbackAt: new Date("2026-08-27T10:00:00.000Z"),
        qualityScore: 1,
        versionId: "test-v2",
      }),
    ]);

    const quality = await getSokoBotQualityOverview({
      versionId: "test-v1",
    });

    expect(quality.overall).toEqual({ turns: 2, judged: 2, avgScore: 3 });
    expect(quality.proactive).toMatchObject({
      sent: 1,
      thumbsUp: 1,
      thumbsDown: 0,
    });
    expect(
      quality.daily.find((day) => day.date === "2026-08-27"),
    ).toMatchObject({
      turns: 1,
      avgScore: 2,
      thumbsDown: 0,
    });
    expect(
      quality.versions.find((version) => version.versionId === "test-v2"),
    ).toMatchObject({ turns: 1, avgScore: 1 });
  });

  it("returns empty metrics for a requested version without recent turns", async () => {
    turnFindManyMock.mockResolvedValue([turn({ versionId: "test-v1" })]);

    const quality = await getSokoBotQualityOverview({
      versionId: "new-authored-version",
    });

    expect(quality.overall).toEqual({ turns: 0, judged: 0, avgScore: null });
    expect(quality.proactive).toMatchObject({
      sent: 0,
      actedOn: 0,
      thumbsUp: 0,
      thumbsDown: 0,
    });
    expect(quality.daily.every((day) => day.turns === 0)).toBe(true);
  });
});

it("does not load tool history when no receipt is claimed", async () => {
  receiptFindManyMock.mockClear();
  turnFindManyMock.mockResolvedValue([turn({ responseContract: null })]);
  await getSokoBotQualityOverview();
  expect(receiptFindManyMock).not.toHaveBeenCalled();
  expect(
    turnFindManyMock.mock.calls.at(-1)?.[0].select.toolCalls,
  ).toBeUndefined();
});

it("checks claimed receipts in bounded batches without loading unrelated tool calls", async () => {
  receiptFindManyMock.mockReset().mockResolvedValue([]);
  turnFindManyMock.mockClear().mockResolvedValue([
    turn({
      createdAt: new Date(),
      responseContract: {
        appliedReceiptIds: Array.from(
          { length: 205 },
          (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        ),
      },
    }),
  ]);
  const result = await getSokoBotQualityOverview();
  expect(result.reliability.invalidActionClaims).toBe(205);
  expect(receiptFindManyMock).toHaveBeenCalledTimes(3);
  for (const [query] of receiptFindManyMock.mock.calls) {
    expect(query.take).toBe(100);
    expect(query.where.id.in.length).toBeLessThanOrEqual(100);
    expect(query.where.actorBotId).toBe("bot-1");
    expect(query.where.turn.workspaceId).toBe("workspace-one");
  }
});
