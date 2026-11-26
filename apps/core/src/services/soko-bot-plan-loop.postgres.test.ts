import { randomUUID } from "node:crypto";
import { DEFAULT_SOKO_BOT_VERSION_ID } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The plan Core keeps for an owner request (planLoop), against PostgreSQL
 * and the real runtime: the chat turn's plan, its background run shown that
 * plan and held to it, and a new chat starting a plan of its own. Only the
 * version is stubbed, to one with planLoop on.
 */

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), SOKO_BOT_ENABLED: true }),
    getBetterAuthPublicBaseUrl: () => null,
  };
});
vi.mock("@/services/soko-bot-version.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-version.service")
    >();
  return {
    ...actual,
    resolveSokoBotVersion: async (id: string | null) => ({
      ...(await actual.resolveSokoBotVersion(id)),
      planLoop: true,
    }),
  };
});

const { default: prisma } = await import("@/lib/db/prisma");
const { sokoBotRuntimeService } = await import(
  "@/services/soko-bot-runtime.service"
);
const { modelUserMessage } = await import("@/lib/soko-bot/turn-model-context");
const { withFixtureSchemas } = await import("@/test/split-layout");

describe.skipIf(!enabled)("planLoop against PostgreSQL", () => {
  const ownerId = randomUUID();
  const workspaceId = randomUUID();
  const sokoBotId = randomUUID();
  let calls = 0;

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        name: "Owner",
        email: `${ownerId}@example.test`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        workspace: { create: { id: workspaceId } },
      },
    });
    await prisma.sokoBot.create({
      data: { id: sokoBotId, userId: ownerId, workspaceId },
    });
  });

  afterAll(async () => {
    await withFixtureSchemas(async (tx) => {
      await tx.sokoBotTurn.deleteMany({ where: { sokoBotId } });
      await tx.sokoBot.deleteMany({ where: { id: sokoBotId } });
      await tx.user.deleteMany({ where: { id: ownerId } });
    });
  });

  async function turn(source: "CHAT", parentTurnId?: string) {
    const id = randomUUID();
    await prisma.sokoBotTurn.create({
      data: {
        id,
        sokoBotId,
        workspaceId,
        requestedByUserId: ownerId,
        askedByUserId: ownerId,
        source,
        status: "RUNNING",
        versionId: DEFAULT_SOKO_BOT_VERSION_ID,
        capabilityNames: ["update_plan"],
        deadlineAt: new Date(Date.now() + 60 * 60 * 1000),
        leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        clientTurnId: parentTurnId ? `background:${id}` : id,
        userMessage: parentTurnId ? "The brief." : "Plan my launch week.",
        ...(parentTurnId ? { parentTurnId, chainDepth: 1 } : {}),
        contextSnapshot: {
          create: {
            generatedAt: new Date(),
            schemaVersion: 1,
            hash: id,
            packet: { trigger: { askedBy: { kind: "OWNER" } } },
            byteSize: 2,
            tokenEstimate: 1,
            counts: {},
            omissions: {},
          },
        },
      },
    });
    return id;
  }

  function updatePlan(turnId: string, steps: unknown[]) {
    calls += 1;
    return sokoBotRuntimeService.executeTool({
      sessionId: `session-${turnId}`,
      turnId,
      capability: "update_plan",
      toolCallId: `call-${calls}`,
      input: { steps },
    } as never);
  }

  const firstMessage = (turnId: string, message: string) =>
    modelUserMessage(
      { turnId, meetingPrep: false, planLoop: true },
      message,
      null,
    );

  it("keeps the chat's plan for its background run and holds the run to it", async () => {
    const chat = await turn("CHAT");
    await expect(
      updatePlan(chat, [
        { step: "Write the posts", status: "in_progress" },
        { step: "Make the pictures", status: "pending" },
      ]),
    ).resolves.toMatchObject({ requestId: chat, revision: 1 });

    const run = await turn("CHAT", chat);
    const message = await firstMessage(run, "The brief.");
    expect(message).toContain("(revision 1)");
    expect(message).toContain("- s1 [in_progress] Write the posts");
    expect(message).toContain("- s2 [pending] Make the pictures");

    await expect(
      updatePlan(run, [{ id: "s1", step: "Write the posts", status: "done" }]),
    ).rejects.toThrow(/Missing: s2 "Make the pictures"/);
    const refused = await prisma.sokoBotToolCall.findFirstOrThrow({
      where: { turnId: run, capability: "update_plan" },
    });
    expect(refused.status).toBe("FAILED");

    await expect(
      updatePlan(run, [
        { id: "s1", step: "Write the posts", status: "done" },
        {
          id: "s2",
          step: "Make the pictures",
          status: "skipped",
          reason: "The owner wants text only",
        },
      ]),
    ).resolves.toMatchObject({ requestId: chat, revision: 2 });
    expect(await firstMessage(run, "Go on.")).toContain(
      "- s2 [skipped: The owner wants text only] Make the pictures",
    );
  });

  it("starts a new chat with no plan and its own request", async () => {
    const chat = await turn("CHAT");
    expect(await firstMessage(chat, "Plan my launch week.")).not.toContain(
      "Your plan for this request",
    );
    await expect(
      updatePlan(chat, [{ step: "Ask what launches", status: "pending" }]),
    ).resolves.toMatchObject({ requestId: chat, revision: 1 });
  });
});
