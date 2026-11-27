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
    // The wake carries the owner's request on, so its answer is checked too.
    const prompt = await evaluateTurnDoneCheck({
      turnId: wake.id,
      sessionId: `session-${wake.id}`,
      draft: "Here is the research.",
    });
    expect(prompt).toContain("- s2 [in_progress] Write the brief from it");
  });

  /** A Core wake on the request `chat` started, as a watch wake is. */
  async function wakeOn(ownerStarted: boolean) {
    const chat = await turn("CHAT");
    await updatePlan(chat, [
      { step: "Have the research done", status: "done" },
      { step: "Write the brief from it", status: "pending" },
    ]);
    // Not the owner's request: another bot asked for it.
    if (!ownerStarted)
      await prisma.sokoBotTurn.update({
        where: { id: chat },
        data: { chainDepth: 1 },
      });
    const wake = await turn("CHAT", chat);
    await prisma.sokoBotTurn.update({
      where: { id: wake },
      data: { source: "EVENT", eveSessionId: `session-${wake}` },
    });
    return evaluateTurnDoneCheck({
      turnId: wake,
      sessionId: `session-${wake}`,
      draft: "Here is the research.",
    });
  }

  it("checks a Core wake on the owner's request", async () => {
    expect(await wakeOn(true)).toContain(
      "- s2 [pending] Write the brief from it",
    );
  });

  it("does not check a Core wake on a request the owner did not start", async () => {
    expect(await wakeOn(false)).toBeNull();
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

    const ownerPrompt = /^You are waiting on the owner/;

    const question =
      "Which account should I schedule them on? I'll wait for your answer.";
    // Two steps the owner's answer does not decide, beside the one it does.
    const threeSteps = [
      { step: "Write the posts", status: "pending" },
      { step: "Schedule them", status: "pending" },
      { step: "Make a picture for each", status: "pending" },
    ];

    it("lets a question about the only step left go to the owner now", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, twoSteps);
      await expect(check(chat, question)).resolves.toBeNull();
    });

    it("asks a turn that waits on the owner to mark what needs the answer and do the rest", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, threeSteps);
      const prompt = await check(chat, question);
      expect(prompt).toMatch(ownerPrompt);
      expect(prompt).toContain("blockedOn owner");
      expect(prompt).toContain("- s2 [pending] Schedule them");
      expect(prompt).toContain("- s3 [pending] Make a picture for each");
    });

    it("counts only owner blockers still open", async () => {
      const call = (turnId: string, n: number, extra: object) =>
        prisma.sokoBotToolCall.create({
          data: {
            turnId,
            toolCallId: `blocker-${turnId}-${n}`,
            capability: "upload_file",
            inputHash: `hash-${n}`,
            ...extra,
          },
        });
      // Refused, then saved under another name: nothing waits on the owner.
      const resolved = await turn("CHAT");
      await updatePlan(resolved, threeSteps);
      await call(resolved, 1, { status: "FAILED", errorKind: "refused" });
      await call(resolved, 2, { status: "COMPLETED" });
      const plain = await check(resolved);
      expect(plain).toMatch(/^Your plan still lists open steps/);
      // Refused and never made good: the turn waits on the owner.
      const open = await turn("CHAT");
      await updatePlan(open, threeSteps);
      await call(open, 1, { status: "FAILED", errorKind: "refused" });
      await expect(check(open)).resolves.toMatch(ownerPrompt);
    });

    it("does not push a request whose finished child left a watch running, and only that request", async () => {
      const watched = async () => {
        const chat = await turn("CHAT");
        await updatePlan(chat, [
          { step: "Ask Maria for the figures", status: "done" },
          { step: "Report her answer", status: "pending" },
        ]);
        return chat;
      };
      const chat = await watched();
      const run = await turn("CHAT", chat);
      await prisma.sokoBotTurn.update({
        where: { id: run },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await prisma.sokoBotWatch.create({
        data: {
          sokoBotId,
          turnId: run,
          kind: "chat_reply",
          targetId: randomUUID(),
          then: "Report Maria's answer to the owner.",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await expect(check(chat)).resolves.toBeNull();
      // Another request with the same plan and no wait of its own.
      const other = await watched();
      await expect(check(other)).resolves.toMatch(
        /^Your plan still lists open steps/,
      );
    });

    it("tells the turn which saves Core has receipts for since the plan, not that they are still to do", async () => {
      const chat = await turn("CHAT");
      // A save before the plan's revision is not news to it.
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: chat,
          toolCallId: `early-${chat}`,
          capability: "upload_file",
          inputHash: "early",
          status: "COMPLETED",
          createdAt: new Date(Date.now() - 60_000),
        },
      });
      await updatePlan(chat, twoSteps);
      // The background run scheduled the posts and the plan was not updated.
      const run = await turn("CHAT", chat);
      await prisma.sokoBotToolCall.create({
        data: {
          turnId: run,
          toolCallId: `schedule-${run}`,
          capability: "schedule_social_post",
          inputHash: "schedule",
          status: "COMPLETED",
        },
      });
      await prisma.sokoBotTurn.update({
        where: { id: run },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      const prompt = await check(chat);
      expect(prompt).toContain(
        "Since your plan's revision 1, Core's receipts show:\n- schedule_social_post: done",
      );
      expect(prompt).toContain("do not do it again");
      expect(prompt).not.toContain("upload_file");
      await expect(openStepsNote(chat)).resolves.toContain(
        "- schedule_social_post: done",
      );
    });

    /** A finished child run's receipts after the plan, as Core settled them. */
    async function childReceipts(
      chat: string,
      receipts: { capability: string; extra: object }[],
    ) {
      const run = await turn("CHAT", chat);
      for (const [n, receipt] of receipts.entries())
        await prisma.sokoBotToolCall.create({
          data: {
            turnId: run,
            toolCallId: `receipt-${run}-${n}`,
            capability: receipt.capability,
            inputHash: `receipt-${n}`,
            status: "COMPLETED",
            ...receipt.extra,
          },
        });
      await prisma.sokoBotTurn.update({
        where: { id: run },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }

    it("never invites a blind retry of a save Core could not confirm", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, twoSteps);
      await childReceipts(chat, [
        {
          capability: "publish_social_post",
          extra: { disposition: "UNKNOWN", verification: "NONE" },
        },
      ]);
      const prompt = await check(chat);
      expect(prompt).toContain(
        "- publish_social_post: Core could not confirm whether it happened",
      );
      expect(prompt).not.toContain("publish_social_post: did not happen");
      expect(prompt).toContain("never repeat it blind");
    });

    it("judges Cuso's Core-checked saves by their own check", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, twoSteps);
      await childReceipts(chat, [
        { capability: "save_strategy", extra: { result: { saved: true } } },
        // Settled COMPLETED, but nothing was written.
        { capability: "write_month_pieces", extra: { result: { written: 0 } } },
      ]);
      const prompt = await check(chat);
      expect(prompt).toContain("- save_strategy: done");
      expect(prompt).toContain("- write_month_pieces: did not happen");
    });

    const savedFile = (filename: string) => {
      const id = randomUUID();
      return {
        capability: "upload_file",
        extra: {
          disposition: "APPLIED",
          verification: "PROVIDER_ACK",
          targetId: id,
          committedAt: new Date(),
          result: { id, filename, size: 64 },
        },
      };
    };

    const savedOnly = (file: string) =>
      `(Core saved ${file}: that proves the save only)`;

    it("shows a saved file beside its step and says a finished step is never still to do", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, [
        { step: "Save the meeting notes as notes.md", status: "pending" },
        { step: "Send Maria the summary", status: "pending" },
      ]);
      await childReceipts(chat, [savedFile("Notes.md")]);
      for (const text of [await openStepsNote(chat), await check(chat)]) {
        expect(text).toContain(
          `- s1 [pending] Save the meeting notes as notes.md ${savedOnly("notes.md")}`,
        );
        expect(text).toContain("- s2 [pending] Send Maria the summary\n");
        expect(text).toContain("never call it still to do");
      }
    });

    it("keeps an attach step open when only the upload is recorded", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, [
        { step: "Prepare the illustration", status: "done" },
        { step: "Attach illustration.png to the draft", status: "pending" },
      ]);
      await childReceipts(chat, [savedFile("illustration.png")]);
      const prompt = await check(chat);
      expect(prompt).toMatch(
        /^Your plan still lists open steps:\n- s2 \[pending\] Attach illustration\.png to the draft/,
      );
      expect(prompt).toContain(savedOnly("illustration.png"));
      expect(prompt).toContain("attached, sent or used is done only once");
    });

    it("ties a saved file to the steps naming that exact file, not a shared word", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, [
        { step: "Save chart.png", status: "pending" },
        { step: "Attach chart.png to the draft", status: "pending" },
        { step: "Save chart-summary.pdf", status: "pending" },
      ]);
      await childReceipts(chat, [savedFile("chart.png")]);
      const note = await openStepsNote(chat);
      expect(note).toContain(
        `- s1 [pending] Save chart.png ${savedOnly("chart.png")}`,
      );
      expect(note).toContain(
        `- s2 [pending] Attach chart.png to the draft ${savedOnly("chart.png")}`,
      );
      expect(note).toContain("- s3 [pending] Save chart-summary.pdf\n");
    });

    it("tells the bot to wait on a strategy Core is still writing", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, twoSteps);
      await childReceipts(chat, [
        { capability: "write_strategy", extra: { result: { writing: true } } },
      ]);
      const prompt = await check(chat);
      expect(prompt).toContain("- write_strategy: started, not finished yet");
      expect(prompt).toContain("do not start it again");
    });

    it("never calls a Studio request Core rejected done", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, twoSteps);
      await childReceipts(chat, [
        {
          capability: "generate_image",
          // The studio refused before sending, and refunded.
          extra: {
            disposition: "REJECTED",
            verification: "NONE",
            result: { status: "FAILED" },
          },
        },
      ]);
      const prompt = await check(chat);
      expect(prompt).toContain("- generate_image: did not happen");
      expect(prompt).not.toContain("generate_image: done");
      expect(prompt).toContain("is still open");
    });

    describe("when the plan marks every step done", () => {
      const allDone = [
        { step: "Write the posts", status: "done" },
        { step: "Schedule them", status: "done" },
      ];
      /** The request's first plan, the child's receipts, then all done. */
      async function finished(
        receipts: { capability: string; extra: object }[],
      ) {
        const chat = await turn("CHAT");
        await updatePlan(chat, twoSteps);
        await childReceipts(chat, receipts);
        await updatePlan(chat, allDone, 1);
        return chat;
      }
      const failedPost = {
        capability: "schedule_social_post",
        extra: { status: "FAILED", errorKind: "provider_error" },
      };
      const scheduledPost = {
        capability: "schedule_social_post",
        extra: {
          disposition: "APPLIED",
          verification: "PROVIDER_ACK",
          targetId: randomUUID(),
          committedAt: new Date(),
        },
      };

      it("sends it back once when a save failed and was never made good", async () => {
        const chat = await finished([failedPost]);
        const prompt = await check(chat);
        expect(prompt).toMatch(
          /^Your plan marks every step done, but Core's receipts for this request show:\n- schedule_social_post: did not happen\n/,
        );
        expect(prompt).toContain("mark its step blocked with the reason");
        expect(await check(chat)).toBeNull();
      });

      /** The same tool call aimed at one post: failed, or scheduled. */
      const forPost = (
        receipt: { capability: string; extra: object },
        post: string,
      ) => ({
        ...receipt,
        extra: { ...receipt.extra, targetId: post, input: { postId: post } },
      });

      it("lets it through once a later call made that save good", async () => {
        const post = randomUUID();
        expect(
          await check(
            await finished([
              forPost(failedPost, post),
              forPost(scheduledPost, post),
            ]),
          ),
        ).toBeNull();
      });

      it("keeps the failure for one post after another post was scheduled", async () => {
        const failed = randomUUID();
        const prompt = await check(
          await finished([
            forPost(failedPost, failed),
            forPost(scheduledPost, randomUUID()),
          ]),
        );
        expect(prompt).toContain(
          `- schedule_social_post (id ${failed}): did not happen`,
        );
      });

      const files = (count: number) =>
        Array.from({ length: count }, (_, n) => savedFile(`asset-${n}.txt`));

      it("checks a failure that comes after forty completed changes", async () => {
        const prompt = await check(await finished([...files(40), failedPost]));
        expect(prompt).toContain("- schedule_social_post: did not happen");
      });

      it("sees a recovery that comes after forty receipts", async () => {
        const post = randomUUID();
        expect(
          await check(
            await finished([
              forPost(failedPost, post),
              ...files(39),
              forPost(scheduledPost, post),
            ]),
          ),
        ).toBeNull();
      });

      it("lets it through when every save is done", async () => {
        expect(await check(await finished([scheduledPost]))).toBeNull();
      });

      it("asks for a read-back of a save Core could not confirm", async () => {
        const chat = await finished([
          {
            capability: "publish_social_post",
            extra: { disposition: "UNKNOWN", verification: "NONE" },
          },
        ]);
        const prompt = await check(chat);
        expect(prompt).toContain(
          "- publish_social_post: Core could not confirm whether it happened",
        );
        expect(prompt).toContain("never repeat it blind");
      });

      it("asks for a wait on a Studio job still running", async () => {
        const projectId = await withFixtureSchemas(
          async (tx) =>
            (
              await tx.project.create({
                data: { workspaceId, name: "Plan loop picture" },
              })
            ).id,
        );
        const job = await prisma.projectImageJob.create({
          data: {
            projectId,
            workspaceId,
            requestedByUserId: ownerId,
            kind: "GENERATE",
            model: "test-model",
            prompt: "A picture",
            settings: {},
            referenceAssetIds: [],
            idempotencyKey: randomUUID(),
            status: "RUNNING",
          },
        });
        const prompt = await check(
          await finished([
            {
              capability: "generate_image",
              extra: {
                disposition: "APPLIED",
                verification: "PROVIDER_ACK",
                targetId: job.id,
                committedAt: new Date(),
              },
            },
          ]),
        );
        expect(prompt).toContain("- generate_image");
        expect(prompt).toContain(": started, not finished yet");
        expect(prompt).toContain("wait_for it");
      });

      it("leaves a plan that already marks the failure blocked alone", async () => {
        const chat = await turn("CHAT");
        await updatePlan(chat, twoSteps);
        await childReceipts(chat, [failedPost]);
        await updatePlan(
          chat,
          [
            { step: "Write the posts", status: "done" },
            {
              step: "Schedule them",
              status: "blocked",
              blockedOn: "external",
              reason: "X refused the post",
            },
          ],
          1,
        );
        expect(await check(chat)).toBeNull();
      });
    });

    it("names which file each save made, so the bot can make the other", async () => {
      const chat = await turn("CHAT");
      await updatePlan(chat, [
        { step: "Save agenda.md", status: "pending" },
        { step: "Save minutes.md", status: "pending" },
      ]);
      const fileId = randomUUID();
      await childReceipts(chat, [
        {
          capability: "upload_file",
          extra: {
            disposition: "APPLIED",
            verification: "PROVIDER_ACK",
            targetId: fileId,
            committedAt: new Date(),
            result: { id: fileId, filename: "minutes.md", size: 120 },
          },
        },
      ]);
      const prompt = await check(chat);
      expect(prompt).toContain(
        `- upload_file ("minutes.md", id ${fileId}): done`,
      );
      expect(prompt).not.toContain('agenda.md"');
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
