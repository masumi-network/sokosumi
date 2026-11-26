/** Opt-in: the X inbox cursor against a migrated, disposable PostgreSQL database.
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… pnpm --filter @sokosumi/core test src/lib/soko-bot/x-inbox.postgres.test.ts
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { readXDm, searchXDms } from "@/services/soko-bot-x-dms.service";

import {
  keepXDms,
  markXDmsSeen,
  type XInboxEntry,
  xInboxSeenIds,
} from "./x-inbox";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const HOUR_MS = 60 * 60 * 1_000;

describe.skipIf(!enabled)("X inbox on PostgreSQL", () => {
  let userId: string;
  let organizationId: string;
  let botId: string;
  let integrationId: string;

  const entry = (id: string, at: Date): XInboxEntry => ({
    id,
    conversationId: "1-2",
    from: "Ruth Weber (@ruthw)",
    createdAt: at.toISOString(),
    text: `text ${id}`,
    fromOwner: false,
  });

  beforeEach(async () => {
    userId = randomUUID();
    organizationId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "X inbox fixture",
        email: `${userId}@example.test`,
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "X inbox fixture",
        slug: organizationId,
      },
    });
    const workspace = await prisma.workspace.create({
      data: { organizationId },
    });
    const bot = await prisma.sokoBot.create({
      data: { userId, workspaceId: workspace.id, versionId: "v37" },
    });
    botId = bot.id;
    const integration = await prisma.sokoBotIntegration.create({
      data: {
        sokoBotId: botId,
        provider: "twitter",
        composioAccountId: `ca_${randomUUID()}`,
        status: "ACTIVE",
      },
    });
    integrationId = integration.id;
  });

  // Fixtures stay: every id is random, and deleting a user or organization
  // fires the calendar erasure trigger, which does not run on the split
  // layout yet (split-layout-pending.txt).
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const cursor = async () =>
    (
      await prisma.sokoBotIntegration.findUniqueOrThrow({
        where: { id: integrationId },
        select: { cursor: true },
      })
    ).cursor;

  it("finds a DM by words past the snippet the bot is shown", async () => {
    const now = new Date();
    await keepXDms(
      integrationId,
      [
        {
          ...entry("long", new Date(now.getTime() - HOUR_MS)),
          text: `${"Hello Robin, ".repeat(30)}the invoice number is INV-4471.`,
        },
      ],
      now,
    );
    expect(
      (await searchXDms(botId, { query: "INV-4471", limit: 10 })).map(
        (message) => message.id,
      ),
    ).toEqual(["long"]);
  });

  it("keeps new DMs and records what the bot was shown", async () => {
    const now = new Date();
    await keepXDms(
      integrationId,
      [entry("a", new Date(now.getTime() - HOUR_MS))],
      now,
    );
    await markXDmsSeen(integrationId, ["a"]);

    expect([...xInboxSeenIds(await cursor())]).toEqual(["a"]);
    expect(
      (await searchXDms(botId, { limit: 10 })).map((message) => message.id),
    ).toEqual(["a"]);
  });

  it("stops serving a quiet account's DMs once they are older than the window", async () => {
    const now = new Date();
    // Kept two days ago; nothing new since, so capture never pruned them.
    const twoDaysAgo = new Date(now.getTime() - 48 * HOUR_MS);
    await keepXDms(
      integrationId,
      [entry("old", new Date(twoDaysAgo.getTime() - HOUR_MS))],
      twoDaysAgo,
    );

    expect(await searchXDms(botId, { limit: 10 })).toEqual([]);
    expect(await readXDm(botId, "old")).toBeNull();
  });
});
