/**
 * Real-Postgres proof of the `network` column on History, Notification and
 * Task events: what its check accepts, what the migration tags, and that a
 * release which does not know the column still writes charged Task events.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/helpers/__tests__/network-column.postgres.test.ts
 *
 * Every test runs in one transaction that is always rolled back.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  HistoryKind,
  NotificationKind,
  type Prisma,
  TaskStatus,
} from "@sokosumi/database";
import {
  createSqlTables,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import { describe, expect, it } from "vitest";

import { onSplitLayout, rolledBack } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const { netTable, netType, sharedTable } = createSqlTables(
  sqlTableLayoutFromEnv(process.env),
);

const migrationSql = readFileSync(
  new URL(
    "../../../../../packages/database/prisma/migrations/20261126114236_network_column/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const TABLES = ["history", "notification", "taskEvent"] as const;
type Table = (typeof TABLES)[number];
type Tx = Prisma.TransactionClient;

/** A user, their workspace and a Task in it: the parents the rows need. */
async function seedParents(tx: Tx) {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await tx.user.create({
    data: {
      id: userId,
      name: "Network Column",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  await tx.workspace.create({ data: { id: workspaceId, userId } });
  const task = await tx.task.create({
    data: { name: "Network column", workspaceId },
  });
  return { userId, workspaceId, taskId: task.id };
}

/** A spend of the given size on Mainnet; returns its id. */
async function seedCharge(tx: Tx, cents: bigint): Promise<string> {
  const id = randomUUID();
  await tx.$executeRaw`
    INSERT INTO ${netTable("mainnet", "Transaction")} ("id", "amount", "updatedAt")
    VALUES (${id}, ${-cents}, NOW())`;
  return id;
}

/** One row in the table with the given value; resolves to its id. */
async function write(
  tx: Tx,
  table: Table,
  parents: { userId: string; taskId: string },
  network: string | null,
): Promise<string> {
  if (table === "history") {
    const row = await tx.history.create({
      data: {
        kind: HistoryKind.TASK,
        entityId: randomUUID(),
        title: "Row",
        status: TaskStatus.READY,
        sortAt: new Date(),
        network,
      },
    });
    return row.id;
  }
  if (table === "notification") {
    const row = await tx.notification.create({
      data: {
        userId: parents.userId,
        kind: NotificationKind.SYSTEM,
        referenceId: randomUUID(),
        eventId: "event",
        messageKey: "key",
        messageParams: "{}",
        network,
      },
    });
    return row.id;
  }
  const row = await tx.taskEvent.create({
    data: { taskId: parents.taskId, network },
  });
  return row.id;
}

/** Each row of the table as JSON without `network`, by id. */
async function rowsWithoutNetwork(tx: Tx, table: Table, ids: string[]) {
  const rows = await tx.$queryRaw<{ id: string; row: unknown }[]>`
    SELECT t."id", to_jsonb(t) - 'network' AS row
    FROM ${sharedTable(table)} t WHERE t."id" = ANY(${ids}) ORDER BY t."id"`;
  return rows;
}

describe.skipIf(!enabled)("the network column", () => {
  it.each(TABLES)(
    "accepts mainnet, preprod and empty on %s, and nothing else",
    async (table) => {
      await rolledBack(async (tx) => {
        const parents = await seedParents(tx);
        for (const network of [null, "mainnet", "preprod"]) {
          await write(tx, table, parents, network);
        }
        for (const network of ["Mainnet", "", "testnet"]) {
          await tx.$executeRawUnsafe("SAVEPOINT refused");
          await expect(write(tx, table, parents, network)).rejects.toThrow(
            `${table}_network_check`,
          );
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT refused");
        }
      });
    },
  );

  it("has its three checks validated", async () => {
    await rolledBack(async (tx) => {
      const validated = await tx.$queryRaw<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE contype = 'c' AND convalidated
          AND conname = ANY(${TABLES.map((table) => `${table}_network_check`)})
        ORDER BY conname`;
      expect(validated.map((row) => row.conname)).toEqual([
        "history_network_check",
        "notification_network_check",
        "taskEvent_network_check",
      ]);
    });
  });

  it("the migration tags JOB rows of History and Notification and changes nothing else", async () => {
    await rolledBack(async (tx) => {
      const { userId, taskId } = await seedParents(tx);
      const transactionId = await seedCharge(tx, 500n);

      const history = Object.values(HistoryKind).map((kind) => ({
        id: randomUUID(),
        kind,
        entityId: randomUUID(),
        title: kind,
        status: TaskStatus.READY,
        sortAt: new Date("2026-03-04T14:15:00.000Z"),
      }));
      await tx.history.createMany({ data: history });
      const notifications = Object.values(NotificationKind).map((kind) => ({
        id: randomUUID(),
        userId,
        kind,
        referenceId: randomUUID(),
        eventId: "event",
        messageKey: "key",
        messageParams: "{}",
      }));
      await tx.notification.createMany({ data: notifications });
      const charged = await tx.taskEvent.create({
        data: { taskId, cents: 500n, transactionId },
      });
      const uncharged = await tx.taskEvent.create({ data: { taskId } });

      // The Task's own History row comes from its triggers: it must stay too.
      const taskHistory = await tx.history.findUniqueOrThrow({
        where: { kind_entityId: { kind: HistoryKind.TASK, entityId: taskId } },
      });
      const ids: Record<Table, string[]> = {
        history: [...history.map((row) => row.id), taskHistory.id],
        notification: notifications.map((row) => row.id),
        taskEvent: [charged.id, uncharged.id],
      };
      const before = {
        history: await rowsWithoutNetwork(tx, "history", ids.history),
        notification: await rowsWithoutNetwork(
          tx,
          "notification",
          ids.notification,
        ),
        taskEvent: await rowsWithoutNetwork(tx, "taskEvent", ids.taskEvent),
      };

      // Twice: a deploy that failed in the middle runs the file again.
      for (const _run of [1, 2]) {
        await tx.$executeRawUnsafe(migrationSql);

        const tagged = {
          history: await tx.history.findMany({
            where: { id: { in: ids.history }, network: { not: null } },
            select: { kind: true, network: true },
          }),
          notification: await tx.notification.findMany({
            where: { id: { in: ids.notification }, network: { not: null } },
            select: { kind: true, network: true },
          }),
          taskEvent: await tx.taskEvent.count({
            where: { id: { in: ids.taskEvent }, network: { not: null } },
          }),
        };
        expect(tagged).toEqual({
          history: [{ kind: HistoryKind.JOB, network: "mainnet" }],
          notification: [{ kind: NotificationKind.JOB, network: "mainnet" }],
          taskEvent: 0,
        });
        expect({
          history: await rowsWithoutNetwork(tx, "history", ids.history),
          notification: await rowsWithoutNetwork(
            tx,
            "notification",
            ids.notification,
          ),
          taskEvent: await rowsWithoutNetwork(tx, "taskEvent", ids.taskEvent),
        }).toEqual(before);
      }
    });
  });

  it("keeps the tag of a Job's History row when the Job changes", async () => {
    await rolledBack(async (tx) => {
      const { userId, workspaceId } = await seedParents(tx);
      const [pricingId, agentId, jobId] = [1, 2, 3].map(() => randomUUID());
      await tx.$executeRaw`
        INSERT INTO ${netTable("mainnet", "AgentPricing")} ("id", "updatedAt", "pricingType")
        VALUES (${pricingId}, NOW(), 'FREE'::${netType("mainnet", "PricingType")})`;
      await tx.$executeRaw`
        INSERT INTO ${netTable("mainnet", "Agent")} (
          "id", "updatedAt", "blockchainIdentifier", "name", "apiBaseUrl",
          "lastUptimeCheck", "uptimeCount", "uptimeCheckCount", "pricingId", "isShown")
        VALUES (${agentId}, NOW(), ${agentId}, 'Agent', 'https://example.test',
          NOW(), 1, 1, ${pricingId}, true)`;
      await tx.$executeRaw`
        INSERT INTO ${netTable("mainnet", "Job")} (
          "id", "updatedAt", "ownerId", "agentId", "agentJobId", "jobType",
          "workspaceId", "name")
        VALUES (${jobId}, NOW(), ${userId}, ${agentId}, 'remote',
          'FREE'::${netType("mainnet", "JobType")}, ${workspaceId}::uuid, 'Before')`;
      const row = () =>
        tx.history.findUniqueOrThrow({
          where: { kind_entityId: { kind: HistoryKind.JOB, entityId: jobId } },
          select: { title: true, network: true },
        });
      // Today's bodies write no Network; the split layout's write it at once.
      expect(await row()).toEqual({
        title: "Before",
        network: onSplitLayout ? "mainnet" : null,
      });

      await tx.$executeRawUnsafe(migrationSql);
      await tx.$executeRaw`
        UPDATE ${netTable("mainnet", "Job")} SET "name" = 'After' WHERE "id" = ${jobId}`;

      expect(await row()).toEqual({ title: "After", network: "mainnet" });
    });
  });

  it("takes a charged Task event from a release that does not know the column", async () => {
    await rolledBack(async (tx) => {
      const old = await seedParents(tx);
      const current = await seedParents(tx);
      const oldCharge = await seedCharge(tx, 500n);
      const currentCharge = await seedCharge(tx, 500n);

      // The previous release names its columns; `network` is not among them.
      const oldEventId = randomUUID();
      await tx.$executeRaw`
        INSERT INTO ${sharedTable("taskEvent")} ("id", "updatedAt", "taskId", "cents", "transactionId")
        VALUES (${oldEventId}, NOW(), ${old.taskId}, 500, ${oldCharge})`;
      const currentEvent = await tx.taskEvent.create({
        data: {
          taskId: current.taskId,
          cents: 500n,
          transactionId: currentCharge,
          network: "mainnet",
        },
      });

      // Both Tasks show the same spend in History.
      const spend = await tx.history.findMany({
        where: {
          kind: HistoryKind.TASK,
          entityId: { in: [old.taskId, current.taskId] },
        },
        select: { amount: true, network: true },
      });
      expect(spend).toEqual([
        { amount: 500n, network: null },
        { amount: 500n, network: null },
      ]);

      // Deleting a Transaction empties the pointer and leaves the Network.
      await tx.$executeRaw`
        DELETE FROM ${netTable("mainnet", "Transaction")}
        WHERE "id" IN (${oldCharge}, ${currentCharge})`;
      const events = await tx.taskEvent.findMany({
        where: { id: { in: [oldEventId, currentEvent.id] } },
        select: { id: true, transactionId: true, network: true },
      });
      expect(events).toHaveLength(2);
      expect(events).toEqual(
        expect.arrayContaining([
          { id: oldEventId, transactionId: null, network: null },
          { id: currentEvent.id, transactionId: null, network: "mainnet" },
        ]),
      );
    });
  });
});
