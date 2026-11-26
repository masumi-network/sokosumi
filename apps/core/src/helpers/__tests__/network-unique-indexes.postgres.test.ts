import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import {
  createSqlTables,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import { describe, expect, it } from "vitest";

import type { Network } from "@/lib/network";
import { withFixtureSchemas } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const { sharedTable, sharedType } = createSqlTables(
  sqlTableLayoutFromEnv(process.env),
);

const indexes = {
  history: {
    old: "history_kind_entityId_key",
    network: "history_network_kind_entityId_key",
    untagged: "history_untagged_kind_entityId_key",
  },
  notification: {
    old: "notification_userId_kind_referenceId_eventId_messageKey_key",
    network: "notification_network_dedupe_key",
    untagged: "notification_untagged_dedupe_key",
  },
};

type Tx = Prisma.TransactionClient;

class Rollback extends Error {}

async function rolledBack(run: (tx: Tx) => Promise<void>) {
  await withFixtureSchemas(async (tx) => {
    await run(tx);
    throw new Rollback();
  }).catch((error) => {
    if (!(error instanceof Rollback)) throw error;
  });
}

async function expectDuplicate(
  tx: Tx,
  insert: () => Promise<number>,
  index: string,
) {
  await tx.$executeRaw`SAVEPOINT duplicate`;
  await expect(insert()).rejects.toThrow(
    `duplicate key value violates unique constraint "${index}"`,
  );
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT duplicate`;
}

async function fixture(tx: Tx, table: keyof typeof indexes) {
  const entityId = randomUUID();
  if (table === "history") {
    return (network: Network | null, kind = "JOB") => tx.$executeRaw`
      INSERT INTO ${sharedTable(table)}
        ("id", "kind", "entityId", "title", "status", "sortAt", "network")
      VALUES (gen_random_uuid()::text, ${kind}::${sharedType("HistoryKind")},
        ${entityId}, 'Fixture', 'READY', NOW(), ${network})`;
  }

  const userId = randomUUID();
  await tx.user.create({
    data: {
      id: userId,
      name: "Fixture",
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return (network: Network | null, kind = "JOB") => tx.$executeRaw`
    INSERT INTO ${sharedTable(table)}
      ("id", "userId", "kind", "referenceId", "eventId", "messageKey", "messageParams", "network")
    VALUES (gen_random_uuid()::text, ${userId}, ${kind}::${sharedType("NotificationKind")},
      ${entityId}, 'event', 'key', '{}', ${network})`;
}

describe.skipIf(!enabled)("Network-aware unique indexes", () => {
  describe.each(["history", "notification"] as const)("%s", (table) => {
    it("keeps the old key in use and has both new indexes valid", async () => {
      await rolledBack(async (tx) => {
        const { old, network, untagged } = indexes[table];
        const valid = await tx.$queryRaw<{ name: string }[]>`
          SELECT c.relname::text AS name
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = ${sharedTable(table).sql}::regclass
            AND i.indisvalid AND c.relname::text IN (${network}, ${untagged})
          ORDER BY c.relname`;
        expect(valid.map(({ name }) => name)).toEqual([network, untagged]);

        const insert = await fixture(tx, table);
        expect(await insert("mainnet")).toBe(1);
        await expectDuplicate(tx, () => insert("preprod"), old);
        await expectDuplicate(tx, () => insert("mainnet"), old);
      });
    });

    it("allows one row per Network and one untagged row per key", async () => {
      await rolledBack(async (tx) => {
        const { old, network, untagged } = indexes[table];
        // DROP INDEX takes ACCESS EXCLUSIVE on the table until rollback.
        // CI has one database per worker. On a shared local test database,
        // reads and writes wait until this transaction ends.
        await tx.$executeRawUnsafe(`DROP INDEX "${old}"`);

        const insert = await fixture(tx, table);
        expect(await insert("mainnet")).toBe(1);
        expect(await insert("preprod")).toBe(1);
        await expectDuplicate(tx, () => insert("mainnet"), network);

        const sharedKind = table === "history" ? "TASK" : "SYSTEM";
        for (const kind of ["JOB", sharedKind]) {
          expect(await insert(null, kind)).toBe(1);
          await expectDuplicate(tx, () => insert(null, kind), untagged);
        }
      });
    });
  });

  it("still plans the live History upsert with only the old arbiter", async () => {
    await rolledBack(async (tx) => {
      const [fn] = await tx.$queryRaw<{ prosrc: string }[]>`
        SELECT prosrc FROM pg_proc
        WHERE oid = 'upsert_history_task(text)'::regprocedure`;
      // Take the final INSERT verbatim from the live function. The typed
      // PL/pgSQL variable lets PostgreSQL resolve the original field references.
      const statement = fn.prosrc.slice(
        fn.prosrc.lastIndexOf("\n  INSERT INTO "),
        fn.prosrc.lastIndexOf(";\nEND;"),
      );
      await tx.$executeRawUnsafe(`
        DO $explain$
        DECLARE
          source_task "task";
          plan json;
        BEGIN
          FOR plan IN EXPLAIN (FORMAT JSON) ${statement}
          LOOP
            PERFORM set_config('test.history_upsert_plan', plan::text, true);
          END LOOP;
        END
        $explain$`);
      const [result] = await tx.$queryRaw<{ arbiters: string[] }[]>`
        SELECT current_setting('test.history_upsert_plan')::json
          -> 0 -> 'Plan' -> 'Conflict Arbiter Indexes' AS arbiters`;
      expect(result.arbiters).toEqual([indexes.history.old]);
    });
  });
});
