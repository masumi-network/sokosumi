import { beforeEach, describe, expect, it, vi } from "vitest";
import { jevRoute } from "@/test/jev-routes";

const {
  resolveDecision,
  turnFindUnique,
  toolFindUnique,
  toolUpsert,
  turnUpdate,
  turnFindFirst,
  transaction,
} = vi.hoisted(() => ({
  resolveDecision: vi.fn(),
  turnFindUnique: vi.fn(),
  toolFindUnique: vi.fn(),
  toolUpsert: vi.fn(),
  turnUpdate: vi.fn(),
  turnFindFirst: vi.fn(),
  transaction: vi.fn(),
}));
const jevEvaluate = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  experimental_evaluate: jevEvaluate,
}));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: vi.fn().mockResolvedValue({ disabled: true }),
}));
vi.mock("@/services/soko-bot-lab-judge.service", () => ({
  judgeTurnQuality: vi.fn(),
  reportFailedTurnJudge: vi.fn(),
}));
vi.mock("@/services/soko-bot-runtime.service", () => ({
  sokoBotRuntimeService: { resolveDecision },
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transaction,
    sokoBotTurn: {
      findUnique: turnFindUnique,
      findFirst: turnFindFirst,
      update: turnUpdate,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sokoBotToolCall: { findUnique: toolFindUnique, upsert: toolUpsert },
    sokoBot: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  },
}));
vi.mock("@/lib/soko-bot/action-response", () => ({
  buildActionResponse: vi.fn().mockResolvedValue({
    answerText: "Created task (task-1).",
    appliedReceiptIds: ["receipt-1"],
    observations: [],
    unfulfilledActions: [],
  }),
}));
vi.mock("@/services/soko-bot-outcome.service", () => ({
  assessSokoBotIntentOutcome: vi.fn(),
  invalidateSokoBotIntentOutcomes: vi.fn(),
  sokoBotOutcomeSummary: vi.fn().mockReturnValue(null),
}));
vi.mock("@/services/soko-bot-delivery.service", () => ({
  enqueueSokoBotDelivery: vi.fn(),
  deliverSokoBotTurnOutbox: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/services/soko-bot-billing.service", () => ({
  recordSokoBotTurnUsage: vi.fn().mockResolvedValue({ shortfall: false }),
  requireSokoBotTurnFunding: vi.fn(),
}));

import prisma from "@/lib/db/prisma";
import { SokoBotControlPlane } from "./soko-bot-control-plane.service";

function confirmation() {
  return {
    id: "confirmation-1",
    intentRevision: 1,
    source: "CHAT",
    chainDepth: 0,
    userId: "owner",
    requestedByUserId: "owner",
    workspaceId: "workspace",
    sokoBotId: "bot",
    userMessage: "yes",
    classification: { continuation: "CONTINUE" },
    status: "STARTING",
    leaseToken: "lease",
    cancellationRequestedAt: null,
    costUsdMicros: 0n,
    chatMention: { message: { roomId: "room" } },
    intent: {
      id: "intent",
      revision: 1,
      requesterId: "owner",
      workspaceId: "workspace",
      sokoBotId: "bot",
      roomId: "room",
      expiresAt: new Date(Date.now() + 60_000),
      state: "AWAITING_CONFIRMATION",
      decisions: [
        {
          id: "decision",
          userId: "owner",
          workspaceId: "workspace",
          sokoBotId: "bot",
          status: "PENDING",
          turnId: "original-turn",
          toolName: "create_task",
        },
      ],
    },
  };
}

// Jev answers every classification; tests that need another route script it.
beforeEach(() => {
  jevEvaluate.mockResolvedValue(jevRoute("DIRECT_RESPONSE"));
});

describe("trusted scoped owner confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    turnFindUnique.mockResolvedValue(confirmation());
    turnFindFirst.mockResolvedValue(confirmation());
    toolFindUnique.mockResolvedValue({
      id: "receipt-1",
      targetId: "task-1",
      inputHash: "original-proposal-hash",
    });
    transaction.mockImplementation(async (callback) => callback(prisma));
  });
  it("executes the existing decision once and settles from its receipt without model work", async () => {
    const plane = new SokoBotControlPlane();
    expect(
      await plane["settleOwnerConfirmation"]("confirmation-1", "lease"),
    ).toBe(true);
    expect(resolveDecision).toHaveBeenCalledWith(
      "owner",
      "decision",
      true,
      true,
      "confirmation-1",
    );
    expect(toolUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          replayedReceiptId: "receipt-1",
          inputHash: "original-proposal-hash",
          verification: "NONE",
          capability: "create_task",
        }),
      }),
    );
    expect(prisma.sokoBotTurn.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          finalAnswer: "Created task (task-1).",
        }),
      }),
    );
  });
  it("recovers after the original decision committed without repeating its effect", async () => {
    const turn = confirmation();
    turn.intent.decisions[0].status = "ACCEPTED";
    turn.intent.state = "IN_PROGRESS";
    turnFindUnique.mockResolvedValue(turn);
    expect(
      await new SokoBotControlPlane()["settleOwnerConfirmation"](
        "confirmation-1",
        "lease",
      ),
    ).toBe(true);
    expect(resolveDecision).not.toHaveBeenCalled();
    expect(toolUpsert).toHaveBeenCalledOnce();
  });
  it("does not turn another actor, room, ambiguous proposal, quotation or bot message into approval", async () => {
    for (const change of [
      { requestedByUserId: "teammate" },
      { chainDepth: 1 },
      { source: "EVENT" },
      // Jev did not read the message as agreeing to the proposal.
      { classification: { continuation: "NEW" } },
      { chatMention: { message: { roomId: "another-room" } } },
      {
        intent: {
          ...confirmation().intent,
          decisions: [
            ...confirmation().intent.decisions,
            ...confirmation().intent.decisions,
          ],
        },
      },
    ]) {
      turnFindUnique.mockResolvedValue({ ...confirmation(), ...change });
      expect(
        await new SokoBotControlPlane()["settleOwnerConfirmation"](
          "confirmation-1",
          "lease",
        ),
      ).toBe(false);
    }
    expect(resolveDecision).not.toHaveBeenCalled();
  });
  it("rejects cancelled or expired confirmations before resolving a decision", async () => {
    for (const change of [
      { cancellationRequestedAt: new Date() },
      { intent: { ...confirmation().intent, expiresAt: new Date(0) } },
    ]) {
      turnFindUnique.mockResolvedValue({ ...confirmation(), ...change });
      await expect(
        new SokoBotControlPlane()["settleOwnerConfirmation"](
          "confirmation-1",
          "lease",
        ),
      ).rejects.toThrow("Confirmation is no longer active");
    }
    expect(resolveDecision).not.toHaveBeenCalled();
  });
});
