import { randomUUID } from "node:crypto";
import { PrismaRaw } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import prisma from "@/lib/db/prisma";
import { requireMutationAuthority } from "@/services/soko-bot-runtime/authorization";
import { databaseNow } from "./database-now";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.runIf(enabled)("databaseNow on PostgreSQL", () => {
  afterAll(() => prisma.$disconnect());

  it.each([
    ["UTC", PrismaRaw.sql`SET LOCAL TIME ZONE 'UTC'`],
    ["Europe/Berlin", PrismaRaw.sql`SET LOCAL TIME ZONE 'Europe/Berlin'`],
    ["America/New_York", PrismaRaw.sql`SET LOCAL TIME ZONE 'America/New_York'`],
  ])("uses the real clock for lease checks in %s", async (_zone, setZone) => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(setZone);
      const userId = randomUUID();
      await tx.user.create({
        data: {
          id: userId,
          name: "Clock owner",
          email: `${userId}@example.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const { id: workspaceId } = await tx.workspace.create({
        data: { userId },
      });
      const { id: sokoBotId } = await tx.sokoBot.create({
        data: { userId, workspaceId, ingestTimezone: "UTC" },
      });
      const readEpochMs = async () => {
        const [{ epochMs }] = await tx.$queryRaw<{ epochMs: number }[]>`
          SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision AS "epochMs"
        `;
        return epochMs;
      };
      const beforeMs = await readEpochMs();
      const nowMs = (await databaseNow(tx)).getTime();
      const afterMs = await readEpochMs();
      expect.soft(nowMs).toBeGreaterThanOrEqual(beforeMs - 1);
      expect.soft(nowMs).toBeLessThanOrEqual(afterMs);

      const leaseMs = 15 * 60_000;
      const turn = await tx.sokoBotTurn.create({
        data: {
          sokoBotId,
          workspaceId,
          requestedByUserId: userId,
          source: "CHAT",
          status: "RUNNING",
          clientTurnId: userId,
          userMessage: "Check the lease",
          capabilityNames: [],
          deadlineAt: new Date(afterMs + leaseMs),
          leaseExpiresAt: new Date(afterMs + leaseMs),
        },
      });
      const authorize = () =>
        requireMutationAuthority(
          { requireWriteScope: async () => undefined },
          tx,
          {
            provenance: { network: "mainnet" },
            turn: { ...turn, actingUserId: userId },
            classificationConfidence: 1,
          },
          false,
        );

      await expect
        .soft(authorize())
        .resolves.toMatchObject({ id: workspaceId });
      await tx.sokoBotTurn.update({
        where: { id: turn.id },
        data: { leaseExpiresAt: new Date(afterMs - leaseMs) },
      });
      await expect
        .soft(authorize())
        .rejects.toThrow("Soko Bot turn is no longer writable");
      await tx.user.delete({ where: { id: userId } });
    });
  });
});
