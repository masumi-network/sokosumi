/**
 * RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *   pnpm --filter core test src/helpers/__tests__/network-unique-indexes.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { HistoryKind, NotificationKind, type Prisma } from "@sokosumi/database";
import {
  createSqlTables,
  sqlTableLayoutFromEnv,
} from "@sokosumi/database/sql-tables";
import { describe, expect, it } from "vitest";

import type { Network } from "@/lib/network";
import {
  onSplitLayout,
  rolledBack,
  testSchemaNames,
} from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const { netTable, sharedTable, sharedType } = createSqlTables(
  sqlTableLayoutFromEnv(process.env),
);
const {
  DATABASE_SCHEMA_SHARED: sharedSchema,
  DATABASE_SCHEMA_MAINNET: mainnetSchema,
} = testSchemaNames();

const INDEXES = {
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

const HISTORY_UPSERTS = [
  {
    schema: sharedSchema,
    procedure: "upsert_history_task(text)",
    splitArbiter: INDEXES.history.untagged,
    declarations: `source_task ${sharedTable("task").sql};`,
    setup: "",
  },
  {
    // Each Network schema holds its own copy (networkFunctions).
    schema: mainnetSchema,
    procedure: "upsert_history_job(text)",
    splitArbiter: INDEXES.history.network,
    declarations: "source_job RECORD;",
    setup: `SELECT j.*, NULL::text AS "agentName" INTO source_job
      FROM ${netTable("mainnet", "Job").sql} AS j WHERE false;`,
  },
  {
    schema: sharedSchema,
    procedure: "upsert_history_image_asset(uuid)",
    splitArbiter: INDEXES.history.untagged,
    declarations: "source RECORD; spend bigint;",
    setup: `SELECT a.*, NULL::text AS "requestedByUserId", NULL::text AS "organizationId"
      INTO source FROM ${sharedTable("project_image_asset").sql} AS a WHERE false;`,
  },
];

type Tx = Prisma.TransactionClient;

async function expectDuplicate(
  tx: Tx,
  insert: () => Promise<number>,
  index?: string,
) {
  await tx.$executeRaw`SAVEPOINT duplicate`;
  const violation = 'duplicate key value violates unique constraint "';
  await expect(insert()).rejects.toThrow(
    index ? `${violation}${index}"` : violation,
  );
  await tx.$executeRaw`ROLLBACK TO SAVEPOINT duplicate`;
}

async function fixture(tx: Tx, table: keyof typeof INDEXES) {
  const entityId = randomUUID();
  if (table === "history") {
    return (
      network: Network | null,
      kind: string = HistoryKind.JOB,
    ) => tx.$executeRaw`
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
  return (
    network: Network | null,
    kind: string = NotificationKind.JOB,
  ) => tx.$executeRaw`
    INSERT INTO ${sharedTable(table)}
      ("id", "userId", "kind", "referenceId", "eventId", "messageKey", "messageParams", "network")
    VALUES (gen_random_uuid()::text, ${userId}, ${kind}::${sharedType("NotificationKind")},
      ${entityId}, 'event', 'key', '{}', ${network})`;
}

describe.skipIf(!enabled)("Network-aware unique indexes", () => {
  describe.each(["history", "notification"] as const)("%s", (table) => {
    // The split layout is the window's end state: its script dropped the
    // old key with the bodies that needed it.
    it.runIf(onSplitLayout)(
      "has both new indexes valid and no old key on the split layout",
      async () => {
        await rolledBack(async (tx) => {
          const { old, network, untagged } = INDEXES[table];
          const valid = await tx.$queryRaw<{ name: string }[]>`
          SELECT c.relname::text AS name
          FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = ${sharedTable(table).sql}::regclass
            AND i.indisvalid AND c.relname::text IN (${network}, ${untagged})
          ORDER BY c.relname`;
          expect(valid.map(({ name }) => name)).toEqual([network, untagged]);
          // Absent, whether valid or not.
          const [gone] = await tx.$queryRaw<{ old: string | null }[]>`
            SELECT to_regclass(${`"${sharedSchema}"."${old}"`})::text AS old`;
          expect(gone.old).toBeNull();
        });
      },
    );

    it.runIf(!onSplitLayout)(
      "keeps the old key in use and has both new indexes valid",
      async () => {
        await rolledBack(async (tx) => {
          const { old, network, untagged } = INDEXES[table];
          const valid = await tx.$queryRaw<{ name: string }[]>`
          SELECT c.relname::text AS name
          FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = ${sharedTable(table).sql}::regclass
            AND i.indisvalid AND c.relname::text IN (${network}, ${untagged})
          ORDER BY c.relname`;
          expect(valid.map(({ name }) => name)).toEqual([network, untagged]);

          const insert = await fixture(tx, table);
          expect(await insert("mainnet")).toBe(1);
          await expectDuplicate(tx, () => insert("preprod"), old);
          await expectDuplicate(tx, () => insert("mainnet"));
        });
      },
    );

    it("allows one row per Network and one untagged row per key", async () => {
      await rolledBack(async (tx) => {
        const { old, network, untagged } = INDEXES[table];
        // DROP INDEX takes ACCESS EXCLUSIVE on the table until rollback.
        // CI has one database per worker. On a shared local test database,
        // reads and writes wait until this transaction ends.
        await tx.$executeRawUnsafe(
          `DROP INDEX IF EXISTS "${sharedSchema}"."${old}"`,
        );

        const insert = await fixture(tx, table);
        expect(await insert("mainnet")).toBe(1);
        expect(await insert("preprod")).toBe(1);
        await expectDuplicate(tx, () => insert("mainnet"), network);

        const sharedKind =
          table === "history" ? HistoryKind.TASK : NotificationKind.SYSTEM;
        for (const kind of [HistoryKind.JOB, sharedKind]) {
          expect(await insert(null, kind)).toBe(1);
          await expectDuplicate(tx, () => insert(null, kind), untagged);
        }
      });
    });
  });

  it.each(HISTORY_UPSERTS)(
    // The split layout runs the bodies of the new layout: a Job's row by its
    // Network, Task and image rows by the key of rows without one.
    onSplitLayout
      ? "plans $procedure with only $splitArbiter"
      : "still plans $procedure with only the old arbiter",
    async ({ schema, procedure, declarations, setup, splitArbiter }) => {
      await rolledBack(async (tx) => {
        const [fn] = await tx.$queryRaw<{ prosrc: string }[]>`
          SELECT prosrc FROM pg_catalog.pg_proc
          WHERE oid = ${`"${schema}".${procedure}`}::regprocedure`;
        // Take the final INSERT verbatim from the live function. The typed
        // PL/pgSQL variable lets PostgreSQL resolve the original field references.
        const start = fn.prosrc.lastIndexOf("\n  INSERT INTO ");
        const end = fn.prosrc.lastIndexOf(";\nEND;");
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        const statement = fn.prosrc.slice(start, end);
        await tx.$executeRawUnsafe(`
        DO $explain$
        DECLARE
          ${declarations}
          plan json;
        BEGIN
          ${setup}
          FOR plan IN EXPLAIN (FORMAT JSON) ${statement}
          LOOP
            PERFORM set_config('test.history_upsert_plan', plan::text, true);
          END LOOP;
        END
        $explain$`);
        const [result] = await tx.$queryRaw<{ arbiters: string[] }[]>`
          SELECT current_setting('test.history_upsert_plan')::json
            -> 0 -> 'Plan' -> 'Conflict Arbiter Indexes' AS arbiters`;
        expect(result.arbiters).toEqual([
          onSplitLayout ? splitArbiter : INDEXES.history.old,
        ]);
      });
    },
  );
});
