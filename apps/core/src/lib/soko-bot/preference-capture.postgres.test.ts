import { randomUUID } from "node:crypto";
import { parseSokoBotMemory } from "@sokosumi/soko-bot";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { buildActionResponse } from "./action-response";
import { formatTrigger } from "./context-packet-format";
import { capturePreference } from "./preference-capture";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const OWNER = `owner-${randomUUID()}`;
const WS = randomUUID();
const BOT = randomUUID();
const MUTE =
  "Do not flag Make scenario errors or DigitalOcean deployment failures.";

const answering = (text: string) => ({
  generate: async () => ({ text, costUsd: 0 }),
});

async function preferences() {
  const latest = await prisma.sokoBotMemoryRevision.findFirst({
    where: { sokoBotId: BOT },
    orderBy: { version: "desc" },
    select: { markdown: true, version: true, source: true },
  });
  const bot = await prisma.sokoBot.findUniqueOrThrow({
    where: { id: BOT },
    select: { memoryVersion: true },
  });
  return {
    lines: parseSokoBotMemory(latest?.markdown ?? "").preferences,
    version: latest?.version ?? 0,
    botVersion: bot.memoryVersion,
    source: latest?.source ?? null,
  };
}

describe.skipIf(!enabled)("preference capture", () => {
  beforeAll(async () => {
    await prisma.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${OWNER}, ${OWNER}, ${`${OWNER}@fixture.invalid`}, true, now(), now())`;
    await prisma.$executeRaw`INSERT INTO workspace (id, "userId", "updatedAt") VALUES (${WS}::uuid, ${OWNER}, now())`;
    await prisma.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${BOT}::uuid, ${OWNER}, ${WS}::uuid, now())`;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM soko_bot WHERE id = ${BOT}::uuid`;
    await prisma.$executeRaw`DELETE FROM workspace WHERE id = ${WS}::uuid`;
    await prisma.$executeRaw`DELETE FROM "user" WHERE id = ${OWNER}`;
  });

  it("saves a stated preference once, and nothing when there is none", async () => {
    const message = "stop messaging me about these deployment failures pls";

    expect(
      await capturePreference(
        { sokoBotId: BOT, message },
        answering(JSON.stringify({ kind: "preference", instruction: MUTE })),
      ),
    ).toMatchObject({ instruction: MUTE, memoryVersion: 1 });
    expect(await preferences()).toEqual({
      lines: [MUTE],
      version: 1,
      botVersion: 1,
      source: "preference_capture",
    });

    // The same preference again, or a message that states none, saves nothing.
    expect(
      await capturePreference(
        { sokoBotId: BOT, message },
        answering(JSON.stringify({ kind: "preference", instruction: MUTE })),
      ),
    ).toBeNull();
    expect(
      await capturePreference(
        { sokoBotId: BOT, message: "thanks!" },
        answering(JSON.stringify({ kind: "none" })),
      ),
    ).toBeNull();
    expect((await preferences()).version).toBe(1);
  });

  it("does not activate standing automation through preference capture", async () => {
    const before = await preferences();
    expect(
      await capturePreference(
        {
          sokoBotId: BOT,
          message: "Whenever a competitor appears, hire an Agent.",
        },
        answering("Hire a market-study Agent whenever a competitor appears."),
      ),
    ).toBeNull();
    expect(await preferences()).toEqual(before);
    for (const message of [
      "Whenever a competitor appears in my mail, hire an Agent for a full market study.",
      "Every Monday, buy a report for at most EUR 5, up to EUR 20 per month.",
      "Every morning, post my task status to the team chat.",
    ]) {
      expect(
        await capturePreference(
          { sokoBotId: BOT, message },
          answering(JSON.stringify({ kind: "automation" })),
        ),
      ).toBeNull();
      expect(await preferences()).toEqual(before);
    }
  });

  it("keeps cost-notification preferences without treating them as spending approval", async () => {
    const instruction = "Tell me when a Task's cost changes.";
    expect(
      await capturePreference(
        { sokoBotId: BOT, message: instruction },
        answering(JSON.stringify({ kind: "preference", instruction })),
      ),
    ).toMatchObject({ instruction });
    expect((await preferences()).lines).toContain(instruction);
  });
  it("confirms the exact committed capture after a later dream revision", async () => {
    const instruction = "Write tasks assigned to Hannah in German.";
    const captured = await capturePreference(
      { sokoBotId: BOT, message: instruction },
      answering(JSON.stringify({ kind: "preference", instruction })),
    );
    expect(captured).not.toBeNull();
    if (!captured) throw new Error("Capture did not persist");
    const original = await prisma.sokoBotMemoryRevision.findUniqueOrThrow({
      where: { id: captured.memoryRevisionId },
    });
    // A later autonomous writer preserves the preference, but has a new identity.
    const later = await prisma.sokoBotMemoryRevision.create({
      data: {
        sokoBotId: BOT,
        version: original.version + 1,
        source: "dreaming",
        markdown: original.markdown,
        hash: "later-memory-hash",
      },
    });
    await prisma.sokoBot.update({
      where: { id: BOT },
      data: { memoryVersion: later.version, memoryHash: later.hash },
    });
    const trigger = formatTrigger(
      {
        userId: OWNER,
        sokoBotId: BOT,
        workspaceId: WS,
        sharedScope: null,
        source: "CHAT",
        personAsked: true,
        capturedPreference: captured,
        classification: {
          schemaVersion: 1,
          route: "MANAGE_WORK",
          confidence: 1,
          requestedOutcome: instruction,
          rationaleSummary: "Owner preference",
          candidateProjectIds: [],
          candidateCoworkerIds: [],
          candidateAgentIds: [],
          requiresClarification: false,
          requiresApproval: false,
        },
      },
      { kind: "OWNER", ownerName: OWNER, askerName: null },
      later,
    );
    expect(trigger.savedPreference).toEqual(captured);
    const turn = await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: BOT,
        workspaceId: WS,
        requestedByUserId: OWNER,
        source: "CHAT",
        status: "RUNNING",
        clientTurnId: randomUUID(),
        userMessage: instruction,
        capabilityNames: [],
        deadlineAt: new Date(Date.now() + 60_000),
        contextSnapshot: {
          create: {
            generatedAt: new Date(),
            schemaVersion: 1,
            hash: "capture-context-hash",
            byteSize: 1,
            tokenEstimate: 1,
            counts: {},
            omissions: {},
            packet: {
              trigger,
              memory: {
                version: later.version,
                hash: later.hash,
                markdown: later.markdown,
              },
            },
          },
        },
      },
    });
    const response = await buildActionResponse(prisma, turn.id, "", true, {
      kind: "REPORT",
      message: null,
      question: null,
      observationToolCallIds: [],
    });
    expect(response.answerText).toBe(
      `Saved preference: ${JSON.stringify(instruction)}.`,
    );
    expect(response.appliedReceiptIds).toEqual([]);
    expect(
      await prisma.sokoBotToolCall.count({ where: { turnId: turn.id } }),
    ).toBe(0);

    // A matching preference alone does not prove this message saved anything.
    const { savedPreference: _capture, ...uncapturedTrigger } = trigger;
    await prisma.sokoBotContextSnapshot.update({
      where: { turnId: turn.id },
      data: {
        packet: {
          trigger: uncapturedTrigger,
          memory: {
            version: later.version,
            hash: later.hash,
            markdown: later.markdown,
          },
        },
      },
    });
    expect(
      (await buildActionResponse(prisma, turn.id, "", true)).answerText,
    ).toBe("Nothing to add.");

    // A proof cannot confirm a revision whose committed hash does not match.
    await prisma.sokoBotContextSnapshot.update({
      where: { turnId: turn.id },
      data: {
        packet: {
          trigger: {
            ...trigger,
            savedPreference: { ...captured, memoryHash: "wrong-hash" },
          },
          memory: {
            version: later.version,
            hash: later.hash,
            markdown: later.markdown,
          },
        },
      },
    });
    expect(
      (await buildActionResponse(prisma, turn.id, "", true)).answerText,
    ).toBe("Nothing to add.");

    const foreignBot = randomUUID();
    await prisma.sokoBot.create({
      data: {
        id: foreignBot,
        userId: OWNER,
        workspaceId: WS,
        deletedAt: new Date(),
      },
    });
    try {
      await prisma.sokoBotTurn.update({
        where: { id: turn.id },
        data: { sokoBotId: foreignBot },
      });
      await prisma.sokoBotContextSnapshot.update({
        where: { turnId: turn.id },
        data: {
          packet: {
            trigger,
            memory: {
              version: later.version,
              hash: later.hash,
              markdown: later.markdown,
            },
          },
        },
      });
      expect(
        (await buildActionResponse(prisma, turn.id, "", true)).answerText,
      ).toBe("Nothing to add.");
    } finally {
      await prisma.sokoBot.delete({ where: { id: foreignBot } });
    }
  });
});
