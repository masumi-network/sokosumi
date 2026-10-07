import { randomUUID } from "node:crypto";
import type { createPrismaClient } from "@sokosumi/database/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { jevRoute } from "@/test/jev-routes";

const jevEvaluate = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  experimental_evaluate: jevEvaluate,
}));
vi.mock("@/lib/db/prisma", async () => {
  const value = process.env.LOCAL_RELIABILITY_DATABASE_URL;
  if (!value) throw new Error("Explicit disposable local database required");
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    ![
      "/soko_reliability_verified",
      "/soko_reliability_integrated",
      "/soko_reliability_integrated_6e",
    ].includes(url.pathname)
  )
    throw new Error(
      "Only the disposable local reliability database is allowed",
    );
  const { createPrismaClient } = await import("@sokosumi/database/client");
  return { default: createPrismaClient(value) };
});
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: vi.fn().mockResolvedValue({ disabled: true }),
}));
vi.mock("@/services/soko-bot-billing.service", () => ({
  recordSokoBotTurnUsage: vi.fn().mockResolvedValue({ shortfall: false }),
  requireSokoBotTurnFunding: vi.fn(),
}));
vi.mock("@/services/soko-bot-outcome.service", () => ({
  assessSokoBotIntentOutcome: vi.fn(),
  invalidateSokoBotIntentOutcomes: vi.fn(),
  sokoBotOutcomeNote: vi.fn().mockReturnValue(null),
  sokoBotOutcomeSummary: vi.fn().mockReturnValue(null),
}));
vi.mock("@/services/soko-bot-delivery.service", () => ({
  enqueueSokoBotDelivery: vi.fn(),
  deliverSokoBotTurnOutbox: vi.fn().mockResolvedValue(undefined),
}));

// Jev answers every classification; tests that need another route script it.
beforeEach(() => {
  jevEvaluate.mockResolvedValue(jevRoute("DIRECT_RESPONSE"));
});

describe.skipIf(!process.env.LOCAL_RELIABILITY_DATABASE_URL)(
  "confirmation proof (isolated local database)",
  () => {
    let db: ReturnType<typeof createPrismaClient>;
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const botId = randomUUID();
    beforeAll(async () => {
      db = (await import("@/lib/db/prisma")).default;
      await db.user.create({
        data: {
          id: userId,
          name: "Confirmation fixture",
          email: `confirmation-${userId}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await db.workspace.create({ data: { id: workspaceId, userId } });
      await db.sokoBot.create({
        data: { id: botId, userId, workspaceId, status: "RUNNING" },
      });
    });
    afterAll(async () => {
      if (!db) return;
      await db.user.deleteMany({ where: { id: userId } });
      await db.$disconnect();
    });
    it("settles a committed decision confirmation using its exact original receipt proof", async () => {
      const { actionInputHash } = await import(
        "@/lib/soko-bot/action-receipts"
      );
      const { SokoBotControlPlane } = await import(
        "./soko-bot-control-plane.service"
      );
      const deadlineAt = new Date(Date.now() + 600_000);
      const original = await db.sokoBotTurn.create({
        data: {
          userId,
          workspaceId,
          sokoBotId: botId,
          source: "CHAT",
          status: "COMPLETED",
          clientTurnId: randomUUID(),
          userMessage: "Propose a task",
          capabilityNames: [],
          deadlineAt,
        },
      });
      const intent = await db.sokoBotIntent.create({
        data: {
          sokoBotId: botId,
          workspaceId,
          requesterId: userId,
          originatingTurnId: original.id,
          desiredOutcome: "Create task",
          targetIds: [],
          allowedActions: ["create_task"],
          acceptanceCriteria: [],
          evidenceIds: [],
          state: "IN_PROGRESS",
          expiresAt: deadlineAt,
        },
      });
      await db.sokoBotTurn.update({
        where: { id: original.id },
        data: { intentId: intent.id, intentRevision: 1 },
      });
      const proposal = { name: "Confirmed task", description: "Proof fixture" };
      const decision = await db.sokoBotPendingDecision.create({
        data: {
          userId,
          workspaceId,
          sokoBotId: botId,
          turnId: original.id,
          intentId: intent.id,
          toolName: "create_task",
          proposal,
          reason: "Owner approval",
          status: "ACCEPTED",
          expiresAt: deadlineAt,
        },
      });
      const source = await db.sokoBotToolCall.create({
        data: {
          turnId: original.id,
          toolCallId: `decision:${decision.id}`,
          capability: "create_task",
          inputHash: actionInputHash(proposal),
          input: proposal,
          status: "COMPLETED",
          disposition: "APPLIED",
          verification: "LOCAL_TRANSACTION",
          actorBotId: botId,
          targetId: "confirmed-task",
          committedAt: new Date(),
        },
      });
      const turn = await db.sokoBotTurn.create({
        data: {
          userId,
          workspaceId,
          sokoBotId: botId,
          source: "CHAT",
          chainDepth: 0,
          status: "STARTING",
          clientTurnId: randomUUID(),
          userMessage: "yes",
          requestedByUserId: userId,
          intentId: intent.id,
          intentRevision: 1,
          deadlineAt,
          leaseToken: "confirmation-lease",
          capabilityNames: ["create_task"],
        },
      });
      expect(
        await new SokoBotControlPlane()["settleOwnerConfirmation"](
          turn.id,
          "confirmation-lease",
        ),
      ).toBe(true);
      const settled = await db.sokoBotTurn.findUniqueOrThrow({
        where: { id: turn.id },
      });
      expect(settled.status).toBe("COMPLETED");
      expect(settled.finalAnswer).toBe(
        "Previously verified: Created task (confirmed-task).",
      );
      expect(settled.responseContract).toMatchObject({
        appliedReceiptIds: [source.id],
        unfulfilledActions: [],
      });
      const marker = await db.sokoBotToolCall.findUniqueOrThrow({
        where: {
          turnId_toolCallId: {
            turnId: turn.id,
            toolCallId: `confirmed:${decision.id}`,
          },
        },
      });
      expect(marker.inputHash).toBe(source.inputHash);
      expect(marker.replayedReceiptId).toBe(source.id);
    });
  },
);
