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
    resolveRunnableSokoBotVersion: async (
      id: string | null | undefined,
      shared?: boolean,
    ) => ({
      ...(await actual.resolveRunnableSokoBotVersion(id, shared)),
      planLoop: true,
    }),
  };
});
// A follow-up wake publishes over Ably and is a proactive turn.
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);
vi.mock("@/services/soko-bot-proactive.service", async (original) => ({
  ...(await original<object>()),
  proactiveGate: async () => ({ ok: true, usedToday: 0, limit: 1_000 }),
}));

const { default: prisma } = await import("@/lib/db/prisma");
const { sokoBotRuntimeService } = await import(
  "@/services/soko-bot-runtime.service"
);
const { modelUserMessage } = await import("@/lib/soko-bot/turn-model-context");
const { evaluateTurnDoneCheck, openStepsNote } = await import(
  "@/lib/soko-bot/done-check"
);
const { withFixtureSchemas } = await import("@/test/split-layout");
const { sokoBotEventsSyncService } = await import(
  "@/services/soko-bot-events-sync.service"
);

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
      data: {
        id: sokoBotId,
        userId: ownerId,
        workspaceId,
        proactiveDailyLimit: 10_000,
      },
    });
    // Event turns are billed: the owner has a balance to start them on.
    const grant = await prisma.transaction.create({
      data: { userId: ownerId, amount: 100_000n * 10_000_000_000n },
    });
    await prisma.creditBucket.create({
      data: {
        userId: ownerId,
        amount: grant.amount,
        sourceTransactionId: grant.id,
      },
    });
    // The events sync reads only events after its first scan.
    await prisma.syncMetadata.upsert({
      where: { key: "soko-events-v2" },
      create: {
        key: "soko-events-v2",
        createdAt: new Date(0),
        lastSyncedAt: new Date(0),
      },
      update: {},
    });
  });

  afterAll(async () => {
    await withFixtureSchemas(async (tx) => {
      await tx.task.deleteMany({ where: { workspaceId } });
      await tx.sokoBotTurn.deleteMany({ where: { sokoBotId } });
      await tx.sokoBot.deleteMany({ where: { id: sokoBotId } });
      // The wake opens the owner's chat with the bot.
      await tx.chatRoom.deleteMany({ where: { createdByUserId: ownerId } });
      await tx.user.deleteMany({ where: { id: ownerId } });
    });
  });

  async function turn(
    source: "CHAT" | "ADMIN_RETRY",
    parentTurnId?: string,
    clientTurnId?: string,
  ) {
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
        capabilityNames: ["update_plan", "create_task"],
        deadlineAt: new Date(Date.now() + 60 * 60 * 1000),
        leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        clientTurnId: clientTurnId ?? (parentTurnId ? `background:${id}` : id),
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

  function updatePlan(turnId: string, steps: unknown[], revision?: number) {
    calls += 1;
    return sokoBotRuntimeService.executeTool({
      sessionId: `session-${turnId}`,
      turnId,
      capability: "update_plan",
      toolCallId: `call-${calls}`,
      input: { steps, ...(revision ? { revision } : {}) },
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
      updatePlan(
        run,
        [{ id: "s1", step: "Write the posts", status: "done" }],
        1,
      ),
    ).rejects.toThrow(/Missing: s2 "Make the pictures"/);
    const refused = await prisma.sokoBotToolCall.findFirstOrThrow({
      where: { turnId: run, capability: "update_plan" },
    });
    expect(refused.status).toBe("FAILED");

    await expect(
      updatePlan(
        run,
        [
          { id: "s1", step: "Write the posts", status: "done" },
          {
            id: "s2",
            step: "Make the pictures",
            status: "skipped",
            reason: "The owner wants text only",
          },
        ],
        1,
      ),
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

  const write = { step: "Write the posts", status: "in_progress" };

  it("shows a run the step a sibling run added, and holds it to that step", async () => {
    const chat = await turn("CHAT");
    await updatePlan(chat, [write]);
    const first = await turn("CHAT", chat);
    await expect(
      updatePlan(
        first,
        [
          { id: "s1", ...write },
          { step: "Send the edited draft", status: "pending" },
        ],
        1,
      ),
    ).resolves.toMatchObject({ requestId: chat, revision: 2 });

    const second = await turn("CHAT", chat);
    expect(await firstMessage(second, "The brief.")).toContain(
      "- s2 [pending] Send the edited draft",
    );
    await expect(
      updatePlan(
        second,
        [{ id: "s1", step: "Write the posts", status: "done" }],
        2,
      ),
    ).rejects.toThrow(/Missing: s2 "Send the edited draft"/);
  });

  it("accepts one of two updates made at once from the same revision", async () => {
    const chat = await turn("CHAT");
    await updatePlan(chat, [write]);
    const both = await Promise.allSettled([
      updatePlan(
        chat,
        [{ id: "s1", step: "Write the posts", status: "done" }],
        1,
      ),
      updatePlan(chat, [{ id: "s1", ...write }], 1),
    ]);
    expect(both.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
  });

  it("never puts back a sibling run's progress from an older revision", async () => {
    const chat = await turn("CHAT");
    const brief = { id: "s1", step: "Write the brief" };
    const list = { id: "s2", step: "Clean the mailing list" };
    await updatePlan(chat, [
      { ...brief, status: "pending" },
      { ...list, status: "pending" },
    ]);
    const first = await turn("CHAT", chat);
    const second = await turn("CHAT", chat);
    // Both runs read revision 1; the first finishes the brief.
    await expect(
      updatePlan(
        first,
        [
          { ...brief, status: "done" },
          { ...list, status: "pending" },
        ],
        1,
      ),
    ).resolves.toMatchObject({ revision: 2 });
    // The second still holds revision 1 and is told the newest plan.
    await expect(
      updatePlan(
        second,
        [
          { ...brief, status: "pending" },
          { ...list, status: "done" },
        ],
        1,
      ),
    ).rejects.toThrow(/revision 2, not 1[\s\S]*- s1 \[done\] Write the brief/);
    await expect(
      updatePlan(
        second,
        [
          { ...brief, status: "done" },
          { ...list, status: "done" },
        ],
        2,
      ),
    ).resolves.toMatchObject({
      revision: 3,
      steps: [
        { id: "s1", status: "done" },
        { id: "s2", status: "done" },
      ],
    });
    // Reopening a step from the current revision is the run's call.
    await expect(
      updatePlan(
        first,
        [
          { ...brief, status: "in_progress" },
          { ...list, status: "done" },
        ],
        3,
      ),
    ).resolves.toMatchObject({ revision: 4 });
  });

  it("keeps the plan for an operator's retry of the failed chat", async () => {
    const chat = await turn("CHAT");
    await updatePlan(chat, [write]);
    await prisma.sokoBotTurn.update({
      where: { id: chat },
      data: { status: "FAILED" },
    });
    const retry = await turn(
      "ADMIN_RETRY",
      undefined,
      `admin-retry:${chat}:operation-1`,
    );
    expect(await firstMessage(retry, "Plan my launch week.")).toContain(
      "- s1 [in_progress] Write the posts",
    );
  });

  it("refuses a plan too long to keep whole and keeps the one before", async () => {
    const chat = await turn("CHAT");
    await updatePlan(chat, [write]);
    // Within each field's limit, but three bytes a character.
    const long = (n: number) => `${"計画".repeat(99)}${n}`;
    await expect(
      updatePlan(
        chat,
        [
          { id: "s1", ...write },
          ...Array.from({ length: 19 }, (_, n) => ({
            step: long(n),
            status: "skipped",
            reason: long(n),
          })),
        ],
        1,
      ),
    ).rejects.toThrow(/too long to keep/);
    const run = await turn("CHAT", chat);
    expect(await firstMessage(run, "The brief.")).toContain("(revision 1)");
  });

  it("lets the Coworker follow-up wake update the plan it is shown, with no sandbox", async () => {
    const chat = await turn("CHAT");
    await updatePlan(chat, [
      { step: "Have the research done", status: "in_progress" },
      { step: "Write the brief from it", status: "pending" },
    ]);
    calls += 1;
    const task = (await sokoBotRuntimeService.executeTool({
      sessionId: `session-${chat}`,
      turnId: chat,
      capability: "create_task",
      toolCallId: `call-${calls}`,
      input: {
        name: "Research three marketplaces",
        description: "Pricing and positioning.",
        status: "READY",
        followUp: "Write the brief from the research.",
      },
    } as never)) as { id: string };
    // The bot is idle again, so the sync wakes it now, not on a later tick.
    await prisma.sokoBotTurn.updateMany({
      where: { sokoBotId, status: "RUNNING" },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await prisma.$transaction([
      prisma.taskEvent.create({
        data: {
          taskId: task.id,
          status: "COMPLETED",
          comment: "Findings: three marketplaces.",
          channel: "SOKOSUMI",
          userId: ownerId,
        },
      }),
      prisma.task.update({
        where: { id: task.id },
        data: { status: "COMPLETED" },
      }),
    ]);
    await sokoBotEventsSyncService.syncDelegatedWork({
      abortSignal: new AbortController().signal,
      shouldContinue: () => true,
    });
    const wake = await prisma.sokoBotTurn.findFirstOrThrow({
      where: { sokoBotId, source: "EVENT" },
    });
    // Core granted the plan tool, and nothing that needs a sandbox.
    expect(wake.capabilityNames).toContain("update_plan");
    expect(wake.capabilityNames).not.toContain("bash");

    await prisma.sokoBotTurn.update({
      where: { id: wake.id },
      data: {
        status: "RUNNING",
        leaseExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        // As the runtime attaches its session to the turn.
        eveSessionId: `session-${wake.id}`,
      },
    });
    expect(await firstMessage(wake.id, wake.userMessage)).toContain(
      "- s2 [pending] Write the brief from it",
    );
    await expect(
      updatePlan(
        wake.id,
        [
          { id: "s1", step: "Have the research done", status: "done" },
          { id: "s2", step: "Write the brief from it", status: "in_progress" },
        ],
        1,
      ),
    ).resolves.toMatchObject({ requestId: chat, revision: 2 });
  });

  describe("the done check", () => {
    const check = (turnId: string, draft = "All done.") =>
      evaluateTurnDoneCheck({
        turnId,
        sessionId: `session-${turnId}`,
        draft,
      });
    const twoSteps = [
      { step: "Write the posts", status: "done" },
      { step: "Schedule them", status: "pending" },
    ];

    it("sends an answer back once while the plan has open steps, even after a restart", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, twoSteps);
      const prompt = await check(chat);
      expect(prompt).toContain("- s2 [pending] Schedule them");
      expect(prompt).toContain("update_plan (revision 1)");
      expect(prompt).not.toContain("Write the posts");
      // A restarted runner asks again: the recorded bounce answers.
      await expect(check(chat)).resolves.toBeNull();
      expect(
        await prisma.sokoBotRuntimeEvent.count({
          where: { turnId: chat, type: "done_check.bounced" },
        }),
      ).toBe(1);
      await expect(openStepsNote(chat)).resolves.toBe(
        "Open steps in your plan (revision 1):\n- s2 [pending] Schedule them",
      );
    });

    it("lets the answer through with no plan, or with every step settled", async () => {
      const bare = await turn("CHAT");
      await expect(check(bare)).resolves.toBeNull();
      const settled = await turn("CHAT");
      await updatePlan(settled, [
        { step: "Write the posts", status: "done" },
        {
          step: "Schedule them",
          status: "blocked",
          blockedOn: "owner",
          reason: "Which account?",
        },
        { step: "Add pictures", status: "skipped", reason: "Text only" },
      ]);
      await expect(check(settled)).resolves.toBeNull();
      await expect(openStepsNote(settled)).resolves.toBeNull();
    });

    it("lets a question to the owner through", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, twoSteps);
      await expect(
        check(chat, "Which account should I schedule them on?"),
      ).resolves.toBeNull();
    });

    it("does not push a turn that waits on a Coworker to poll", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, twoSteps);
      await prisma.sokoBotDelegation.create({
        data: {
          turnId: chat,
          toolCallId: `create-task-${chat}`,
          kind: "TASK",
          action: "create_task",
          followUp: "Schedule the posts when the review is back.",
        },
      });
      await expect(check(chat)).resolves.toBeNull();
    });
  });
});
