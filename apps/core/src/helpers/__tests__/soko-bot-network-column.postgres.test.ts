import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createSqlTables,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import { describe, expect, it } from "vitest";

import { withFixtureSchemas } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const { netTable, netType, sharedTable } = createSqlTables(
  sqlTableLayoutFromEnv(process.env),
);
const migration = readFileSync(
  new URL(
    "../../../../../packages/database/prisma/migrations/20261126144339_soko_bot_network/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const TABLES = [
  "soko_bot_turn",
  "soko_bot_delegation",
  "soko_bot_schedule",
] as const;

class Rollback extends Error {}

describe.skipIf(!enabled)("Soko Bot network migration", () => {
  it("tags old turns and Job-linked rows once, preserving timestamps and FK actions", async () => {
    await withFixtureSchemas(async (tx) => {
      // Recreate the old layout on the disposable worker database. Rollback
      // restores the original columns, rows and catalog after the test.
      for (const table of TABLES) {
        await tx.$executeRaw`ALTER TABLE ${sharedTable(table)} DROP COLUMN "network"`;
      }

      const userId = randomUUID();
      await tx.user.create({
        data: {
          id: userId,
          name: "Old Soko Bot owner",
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
        data: { userId, workspaceId },
      });
      const { id: taskId } = await tx.task.create({
        data: { workspaceId, name: "Watched Task" },
      });

      const pricingId = randomUUID();
      const agentId = randomUUID();
      const jobId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO ${netTable("mainnet", "AgentPricing")} ("id", "updatedAt", "pricingType")
        VALUES (${pricingId}, NOW(), 'FREE'::${netType("mainnet", "PricingType")})`;
      await tx.$executeRaw`
        INSERT INTO ${netTable("mainnet", "Agent")} (
          "id", "updatedAt", "blockchainIdentifier", "name", "lastUptimeCheck",
          "uptimeCount", "uptimeCheckCount", "pricingId", "isShown")
        VALUES (${agentId}, NOW(), ${agentId}, 'Agent', NOW(), 1, 1, ${pricingId}, true)`;
      await tx.$executeRaw`
        INSERT INTO ${netTable("mainnet", "Job")} (
          "id", "updatedAt", "ownerId", "agentId", "agentJobId", "jobType", "workspaceId")
        VALUES (${jobId}, NOW(), ${userId}, ${agentId}, 'remote',
          'FREE'::${netType("mainnet", "JobType")}, ${workspaceId}::uuid)`;

      const updatedAt = new Date("2026-03-04T14:15:00.000Z");
      const turnData = {
        sokoBotId,
        workspaceId,
        updatedAt,
        source: "CHAT",
        userMessage: "Old turn",
        deadlineAt: new Date(),
      } as const;
      const turn = (network?: string) =>
        tx.sokoBotTurn.create({
          data: {
            ...turnData,
            capabilityNames: [],
            clientTurnId: randomUUID(),
            ...(network === undefined ? {} : { network }),
          },
          select: { id: true },
        });
      const { id: turnId } = await turn();

      const delegation = (
        link: { jobId?: string; taskId?: string } = {},
        network?: string,
      ) =>
        tx.sokoBotDelegation.create({
          data: {
            turnId,
            updatedAt,
            toolCallId: randomUUID(),
            kind: link.taskId ? "TASK" : "JOB",
            action: "fixture",
            ...link,
            ...(network === undefined ? {} : { network }),
          },
          select: { id: true },
        });
      const schedule = (
        link: { jobId?: string; taskId?: string } = {},
        network?: string,
      ) =>
        tx.sokoBotSchedule.create({
          data: {
            sokoBotId,
            workspaceId,
            updatedAt,
            name: "Old schedule",
            timezone: "UTC",
            cronExpression: "0 * * * *",
            prompt: "Check in",
            nextRunAt: new Date(),
            ...link,
            ...(network === undefined ? {} : { network }),
          },
          select: { id: true },
        });
      const delegates = [
        await delegation({ jobId }),
        await delegation({ taskId }),
        await delegation(),
      ] as const;
      const schedules = [
        await schedule({ jobId }),
        await schedule({ taskId }),
        await schedule(),
      ] as const;

      const readTags = async (
        table: (typeof TABLES)[number],
        ids: readonly { id: string }[],
      ) => {
        const rows = await tx.$queryRaw<
          { id: string; network: string | null; updatedAt: Date }[]
        >`
          SELECT "id", "network", "updatedAt" FROM ${sharedTable(table)}
          WHERE "id" = ANY(${ids.map(({ id }) => id)}::uuid[])
        `;
        return ids.map(({ id }) => rows.find((row) => row.id === id));
      };
      const fixtures = [[{ id: turnId }], delegates, schedules] as const;
      const expectLegacyTags = async () => {
        for (const [index, table] of TABLES.entries()) {
          const ids = fixtures[index] ?? [];
          expect(await readTags(table, ids)).toStrictEqual(
            ids.map(({ id }, row) => ({
              id,
              network: row === 0 ? "mainnet" : null,
              updatedAt,
            })),
          );
        }
      };
      await tx.$executeRawUnsafe(migration);
      await expectLegacyTags();

      const alreadyTagged = [
        await turn("preprod"),
        await delegation({ jobId }, "preprod"),
        await schedule({ jobId }, "preprod"),
      ];
      await tx.$executeRawUnsafe(migration);
      await expectLegacyTags();
      for (const [index, table] of TABLES.entries()) {
        const tagged = alreadyTagged[index];
        if (!tagged) throw new Error(`Missing fixture for ${table}`);
        expect(await readTags(table, [tagged])).toEqual([
          { ...tagged, network: "preprod", updatedAt },
        ]);
      }

      const validated = await tx.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'c' AND convalidated
          AND conname = ANY(${TABLES.map((table) => `${table}_network_check`)})
        ORDER BY conname
      `;
      expect(validated.map(({ conname }) => conname)).toEqual(
        TABLES.map((table) => `${table}_network_check`).sort(),
      );

      for (const [table, insert] of [
        ["soko_bot_turn", turn],
        ["soko_bot_delegation", (network?: string) => delegation({}, network)],
        ["soko_bot_schedule", (network?: string) => schedule({}, network)],
      ] as const) {
        const old = await insert();
        const preprod = await insert("preprod");
        expect(await readTags(table, [old, preprod])).toEqual([
          { ...old, network: null, updatedAt },
          { ...preprod, network: "preprod", updatedAt },
        ]);
        await tx.$executeRawUnsafe("SAVEPOINT invalid_network");
        await expect(insert("testnet")).rejects.toThrow(
          `${table}_network_check`,
        );
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT invalid_network");
      }

      await tx.$executeRaw`DELETE FROM ${netTable("mainnet", "Job")} WHERE "id" = ${jobId}`;
      await expect(
        tx.sokoBotDelegation.findUnique({ where: { id: delegates[0].id } }),
      ).resolves.toMatchObject({ jobId: null, network: "mainnet" });
      await expect(
        tx.sokoBotSchedule.findUnique({ where: { id: schedules[0].id } }),
      ).resolves.toBeNull();

      await tx.task.delete({ where: { id: taskId } });
      await expect(
        tx.sokoBotDelegation.findUnique({ where: { id: delegates[1].id } }),
      ).resolves.toMatchObject({ taskId: null, network: null });
      await expect(
        tx.sokoBotSchedule.findUnique({ where: { id: schedules[1].id } }),
      ).resolves.toBeNull();

      await tx.sokoBotTurn.delete({ where: { id: turnId } });
      await expect(
        tx.sokoBotDelegation.count({ where: { turnId } }),
      ).resolves.toBe(0);
      throw new Rollback();
    }).catch((error) => {
      if (!(error instanceof Rollback)) throw error;
    });
  });
});
