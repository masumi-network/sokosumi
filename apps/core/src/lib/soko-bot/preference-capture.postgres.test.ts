import { randomUUID } from "node:crypto";
import { parseSokoBotMemory } from "@sokosumi/soko-bot";
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
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
  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM soko_bot WHERE id = ${BOT}::uuid`;
    await prisma.$executeRaw`DELETE FROM workspace WHERE id = ${WS}::uuid`;
    await prisma.$executeRaw`DELETE FROM "user" WHERE id = ${OWNER}`;
  });

  it("saves a stated preference once, and nothing when there is none", async () => {
    await prisma.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${OWNER}, ${OWNER}, ${`${OWNER}@fixture.invalid`}, true, now(), now())`;
    await prisma.$executeRaw`INSERT INTO workspace (id, "userId", "updatedAt") VALUES (${WS}::uuid, ${OWNER}, now())`;
    await prisma.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${BOT}::uuid, ${OWNER}, ${WS}::uuid, now())`;
    const message = "stop messaging me about these deployment failures pls";

    expect(
      await capturePreference({ sokoBotId: BOT, message }, answering(MUTE)),
    ).toBe(MUTE);
    expect(await preferences()).toEqual({
      lines: [MUTE],
      version: 1,
      botVersion: 1,
      source: "preference_capture",
    });

    // The same preference again, or a message that states none, saves nothing.
    expect(
      await capturePreference({ sokoBotId: BOT, message }, answering(MUTE)),
    ).toBeNull();
    expect(
      await capturePreference(
        { sokoBotId: BOT, message: "thanks!" },
        answering("NONE"),
      ),
    ).toBeNull();
    expect((await preferences()).version).toBe(1);
  });
});
