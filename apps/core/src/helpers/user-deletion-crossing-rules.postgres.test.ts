import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  NETWORK_TO_SHARED_KEYS,
  SHARED_TO_NETWORK_KEYS,
} from "@/lib/db/crossing-keys";
import type { Network } from "@/lib/network";
import { onSplitLayout, testSchemaNames } from "@/test/split-layout";
import {
  type DeletionBlocker,
  type DeletionWorld,
  seedDeletionBlocker,
  seedDeletionWorld,
} from "@/test-fixtures/user-deletion-world";

const ON_POSTGRES =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres"));

// The oracle is the database: with Core's own steps switched off, the foreign
// keys alone decide what an account deletion removes, clears or refuses, as
// they did before Core enforced them.
//
// Needs the database to itself, as CI's one database per worker gives it
// (`POSTGRES_TEST_DATABASE_PER_WORKER=true`), or run this file alone: it
// compares every table, and drops the keys inside its transaction, which
// locks their tables against every other session until it rolls back.
const core = vi.hoisted(() => ({ appliesTheRules: true }));
vi.mock("./user-deletion-crossing-rules", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./user-deletion-crossing-rules")>();
  return Object.fromEntries(
    Object.entries(actual).map(([name, apply]) => [
      name,
      (...args: unknown[]) =>
        core.appliesTheRules
          ? (apply as (...args: unknown[]) => unknown)(...args)
          : undefined,
    ]),
  );
});
vi.mock("@sentry/node", () => ({ captureMessage: vi.fn() }));

type Tx = Prisma.TransactionClient;
type Digests = Record<string, string>;

const ownedByUser = (owners: readonly string[]) => owners.includes("user");

interface ReferencedParents {
  key: string;
  parentTable: PrismaRaw.Sql;
  ids: string[];
}

/**
 * For every key of this flow that deletes or clears, on every Network it
 * applies to: the parent rows that child rows point at now.
 */
async function referencedParents(
  tx: Tx,
  networks: readonly Network[],
): Promise<ReferencedParents[]> {
  const keys = networks.flatMap((network) => [
    ...NETWORK_TO_SHARED_KEYS.map(
      ([child, column, parent, onDelete, , , owners]) => ({
        key: `${network} ${child}.${column}`,
        childTable: netTable(network, child),
        column,
        parentTable: sharedTable(parent),
        filter: PrismaRaw.empty,
        applies: onDelete !== "Restrict" && ownedByUser(owners),
      }),
    ),
    ...SHARED_TO_NETWORK_KEYS.map(
      ([child, column, parent, , , , owners, routing]) => ({
        key: `${network} ${child}.${column}`,
        childTable: sharedTable(child),
        column,
        parentTable: netTable(network, parent),
        // A row with a Network belongs to it, one without to Mainnet.
        filter:
          routing === "tagged"
            ? PrismaRaw.sql`AND COALESCE(c.network, 'mainnet') = ${network}`
            : PrismaRaw.empty,
        applies:
          ownedByUser(owners) &&
          (routing === "tagged" || network === "mainnet"),
      }),
    ),
  ]);
  const parents: ReferencedParents[] = [];
  for (const {
    key,
    childTable,
    column,
    parentTable,
    filter,
    applies,
  } of keys) {
    if (!applies) continue;
    const reference = PrismaRaw.raw(`c."${column}"`);
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT ${reference}::text AS id
      FROM ${childTable} c
      WHERE ${reference} IS NOT NULL ${filter}
    `;
    parents.push({ key, parentTable, ids: rows.map(({ id }) => id) });
  }
  return parents;
}

/** The keys whose rows pointed at a parent that is gone now. */
async function keysWithAParentGone(
  tx: Tx,
  parents: readonly ReferencedParents[],
): Promise<string[]> {
  const gone: string[] = [];
  for (const { key, parentTable, ids } of parents) {
    const [{ left }] = await tx.$queryRaw<{ left: number }[]>`
      SELECT count(*)::int AS left FROM ${parentTable} WHERE id::text = ANY(${ids})
    `;
    if (left < ids.length) gone.push(key);
  }
  return gone;
}

// What PostgreSQL generates anew for a row in every run, so no two runs
// agree on it: an invalidation's id and its number from a sequence. Every
// other value of every table is compared.
const RUN_SPECIFIC: Record<string, string> = {
  calendar_invalidation_outbox:
    "(to_jsonb(t) - 'id' - 'calendarRevision') #- '{payload,calendarRevision}'",
};

/** Row count and a digest of every row, for every table of this layout. */
async function tableDigests(tx: Tx): Promise<Digests> {
  const schemas = [...new Set(Object.values(testSchemaNames()))];
  const tables = await tx.$queryRaw<{ name: string; table: string }[]>`
    SELECT format('%I.%I', n.nspname, c.relname) AS name, c.relname AS table
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY(${schemas})
    ORDER BY 1
  `;
  const rows = await tx.$queryRawUnsafe<{ name: string; digest: string }[]>(
    tables
      .map(({ name, table }) => {
        const row = `md5((${RUN_SPECIFIC[table] ?? "t"})::text)`;
        return `
          SELECT '${name}' AS name, count(*) || ' rows ' || md5(COALESCE(
            string_agg(${row}, '' ORDER BY ${row}), '')) AS digest
          FROM ${name} t`;
      })
      .join(" UNION ALL "),
  );
  return Object.fromEntries(rows.map(({ name, digest }) => [name, digest]));
}

/** Core's refusal code, or "foreign key" for a key's own violation. */
function refusalCode(error: {
  code?: string;
  body?: { code?: string };
  meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
}): string | undefined {
  // 23503 is a key's violation, 23001 its RESTRICT form; Prisma reports a
  // model call's as P2003.
  const postgresCode = error.meta?.driverAdapterError?.cause?.originalCode;
  return error.code === "P2003" ||
    postgresCode === "23503" ||
    postgresCode === "23001"
    ? "foreign key"
    : (error.body?.code ?? error.code);
}

/** Drops every foreign key between a Network's schema and the shared one. */
async function dropCrossingKeys(tx: Tx): Promise<number> {
  const keys = [...NETWORK_TO_SHARED_KEYS, ...SHARED_TO_NETWORK_KEYS];
  const statements = await tx.$queryRaw<{ statement: string }[]>`
    SELECT format('ALTER TABLE %s DROP CONSTRAINT %I', con.conrelid::regclass, con.conname) AS statement
    FROM pg_constraint con
    JOIN pg_class child ON child.oid = con.conrelid
    JOIN pg_class parent ON parent.oid = con.confrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    JOIN unnest(
      ${keys.map(([child]) => child)}::text[],
      ${keys.map(([, column]) => column)}::text[],
      ${keys.map(([, , parent]) => parent)}::text[]
    ) AS key(child, child_column, parent)
      ON key.child = child.relname AND key.child_column = att.attname AND key.parent = parent.relname
    WHERE con.contype = 'f'
  `;
  for (const { statement } of statements) {
    await tx.$executeRawUnsafe(statement);
  }
  return statements.length;
}

describe.runIf(ON_POSTGRES)(
  "the account deletion and the crossing keys",
  () => {
    let prisma: typeof import("@/lib/db/prisma").default;
    let prepareTasksForUserDeletion: typeof import("./user-deletion-tasks").prepareTasksForUserDeletion;
    let countOrphans: typeof import("@/lib/db/crossing-key-orphans").countCrossingKeyOrphans;
    const networks: Network[] = onSplitLayout
      ? ["mainnet", "preprod"]
      : ["mainnet"];

    beforeAll(async () => {
      vi.stubEnv("NETWORK_PREPROD_ENABLED", onSplitLayout ? "true" : "false");
      ({ default: prisma } = await import("@/lib/db/prisma"));
      ({ prepareTasksForUserDeletion } = await import("./user-deletion-tasks"));
      ({ countCrossingKeyOrphans: countOrphans } = await import(
        "@/lib/db/crossing-key-orphans"
      ));
      // Core stamps rows with its own clock; every run must stamp the same.
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-01") });
    }, 60_000);

    afterAll(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    });

    /** Seeds a world, runs `run` on it, and rolls everything back. */
    async function inWorld(
      run: (tx: Tx, world: DeletionWorld) => Promise<void>,
    ): Promise<void> {
      const rollback = new Error("Roll back the world");
      await expect(
        prisma.$transaction(
          async (tx) => {
            const world = await seedDeletionWorld(tx, networks);
            await tx.$executeRaw`SAVEPOINT world`;
            await run(tx, world);
            throw rollback;
          },
          { timeout: 120_000 },
        ),
      ).rejects.toBe(rollback);
    }

    /** The deletion, inside the world's transaction so it rolls back with it. */
    function deleteAccount(
      tx: Tx,
      userId: string,
      options: { rules: boolean; beforeUserDelete?: () => Promise<void> },
    ): Promise<void> {
      core.appliesTheRules = options.rules;
      // The chat rooms are read after the Jobs went and before the User does.
      const chatRoom = {
        ...tx.chatRoom,
        findMany: async (...args: Parameters<Tx["chatRoom"]["findMany"]>) => {
          await options.beforeUserDelete?.();
          return tx.chatRoom.findMany(...args);
        },
      };
      const client = new Proxy(tx, {
        get: (target, property, receiver) =>
          property === "chatRoom"
            ? chatRoom
            : Reflect.get(target, property, receiver),
      });
      return prepareTasksForUserDeletion(userId, {
        $transaction: (callback: (client: Tx) => Promise<unknown>) =>
          callback(client),
      } as never);
    }

    async function backToTheWorld(tx: Tx) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT world`;
    }

    it("leaves every table as the keys alone leave it, with the keys and without them", async () => {
      let seeded: Digests = {};
      let byTheKeys: Digests = {};
      let byCoreBesideTheKeys: Digests = {};
      let byCoreAlone: Digests = {};
      let orphansByCoreAlone: Awaited<ReturnType<typeof countOrphans>> = [];
      let parents: ReferencedParents[] = [];
      let keysThatFired: string[] = [];
      let droppedKeys = 0;

      await inWorld(async (tx, { ada }) => {
        seeded = await tableDigests(tx);
        parents = await referencedParents(tx, networks);

        await deleteAccount(tx, ada, { rules: false });
        byTheKeys = await tableDigests(tx);
        keysThatFired = await keysWithAParentGone(tx, parents);
        await backToTheWorld(tx);

        await deleteAccount(tx, ada, { rules: true });
        byCoreBesideTheKeys = await tableDigests(tx);
        await backToTheWorld(tx);

        droppedKeys = await dropCrossingKeys(tx);
        await deleteAccount(tx, ada, { rules: true });
        byCoreAlone = await tableDigests(tx);
        orphansByCoreAlone = await countOrphans(tx);
      });

      // 23 keys from each Network into shared, 8 from shared into Mainnet.
      expect(droppedKeys).toBe(23 * networks.length + 8);
      expect(byTheKeys).not.toEqual(seeded);
      expect(byCoreBesideTheKeys).toEqual(byTheKeys);
      expect(byCoreAlone).toEqual(byTheKeys);
      expect(orphansByCoreAlone.filter(({ count }) => count > 0n)).toEqual([]);

      // The world holds a row behind every key that deletes or clears, on
      // every Network the key applies to: the deletion removed a row it
      // pointed at. A key added to the table without a row here fails this.
      expect(keysThatFired).toEqual(parents.map(({ key }) => key));
      // 13 keys out of a Network and 8 into Mainnet; 3 of the 8 into Preprod.
      expect(parents).toHaveLength(networks.length === 2 ? 37 : 21);
    }, 120_000);

    const BLOCKERS: Record<
      DeletionBlocker,
      { key: string; code: string; late?: true }
    > = {
      "job hired by a Soko Bot": {
        key: "Job.creatorSokoBotId",
        code: "ACCOUNT_DELETION_SOKO_BOT_HIRED_JOB",
      },
      "job hired by the personal Project's Soko Bot, in the personal workspace":
        {
          key: "Job.creatorSokoBotId",
          code: "ACCOUNT_DELETION_SOKO_BOT_HIRED_JOB",
        },
      "payment on a subtask": {
        key: "task_x402_payment.taskId",
        code: "ACCOUNT_DELETION_SUBTASK_HAS_PAYMENT",
      },
      "job in the personal workspace": {
        key: "Job.workspaceId",
        code: "ACCOUNT_DELETION_WORKSPACE_HAS_JOB",
        late: true,
      },
    };

    it("has a refusal case for every key of this flow that restricts", () => {
      expect(
        [...new Set(Object.values(BLOCKERS).map(({ key }) => key))].sort(),
      ).toEqual(
        NETWORK_TO_SHARED_KEYS.filter(
          ([, , , onDelete, , , owners]) =>
            onDelete === "Restrict" && ownedByUser(owners),
        )
          .map(([child, column]) => `${child}.${column}`)
          .sort(),
      );
    });

    describe.each(networks)("a blocking row on %s", (network) => {
      it.each(
        Object.entries(BLOCKERS) as [
          DeletionBlocker,
          (typeof BLOCKERS)[DeletionBlocker],
        ][],
      )(
        "refuses on a %s, where the key refuses",
        async (blocker, { code, late }) => {
          await inWorld(async (tx, world) => {
            const add = () => seedDeletionBlocker(tx, network, world, blocker);
            const refused = async (rules: boolean) => {
              if (!late) await add();
              const outcome = await deleteAccount(tx, world.ada, {
                rules,
                beforeUserDelete: late ? add : undefined,
              }).then(() => "deleted", refusalCode);
              const transaction = await tx.$queryRaw`SELECT 1`.then(
                () => "open",
                () => "aborted",
              );
              await backToTheWorld(tx);
              return [outcome, transaction];
            };

            // The key's own error, which leaves the transaction aborted.
            expect(await refused(false)).toEqual(["foreign key", "aborted"]);
            expect(await refused(true)).toEqual([code, "open"]);
            await dropCrossingKeys(tx);
            await tx.$executeRaw`SAVEPOINT world`;
            expect(await refused(true)).toEqual([code, "open"]);
          });
        },
        120_000,
      );
    });
  },
);
