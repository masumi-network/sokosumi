import type { Prisma } from "@sokosumi/database";
import { expect } from "vitest";

import { NETWORK_TO_SHARED_KEYS } from "@/lib/db/crossing-keys";
import type { Network } from "@/lib/network";
import { testSchemaNames } from "@/test/split-layout";

type Tx = Prisma.TransactionClient;
type Flow = (typeof NETWORK_TO_SHARED_KEYS)[number][6][number];

/** The keys from a Network into `shared` whose parent `flow` deletes. */
export function keysFor(flow: Flow) {
  return NETWORK_TO_SHARED_KEYS.filter((key) =>
    (key[6] as readonly Flow[]).includes(flow),
  );
}

/** Drops `flow`'s keys in each of `networks`, as ticket 54 will. */
export async function dropFlowCrossingKeys(
  tx: Tx,
  flow: Flow,
  networks: readonly Network[],
) {
  const keys = keysFor(flow);
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
    ) AS key(child, column_name, parent)
      ON key.child = child.relname
      AND key.column_name = att.attname
      AND key.parent = parent.relname
    WHERE con.contype = 'f'
    ORDER BY statement
  `;
  expect(statements).toHaveLength(keys.length * networks.length);
  for (const { statement } of statements) await tx.$executeRawUnsafe(statement);
}

/** Compare every table in PostgreSQL, excluding generated outbox identifiers. */
export async function digests(tx: Tx) {
  const schemas = [...new Set(Object.values(testSchemaNames()))];
  const tables = await tx.$queryRaw<{ name: string; table: string }[]>`
    SELECT format('%I.%I', n.nspname, c.relname) AS name, c.relname AS table
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND n.nspname = ANY(${schemas})
    ORDER BY 1
  `;
  return tx.$queryRawUnsafe<{ name: string; digest: string }[]>(
    tables
      .map(({ name, table }) => {
        const value =
          table === "calendar_invalidation_outbox"
            ? "(to_jsonb(t) - 'id' - 'calendarRevision') #- '{payload,calendarRevision}'"
            : "t";
        return `SELECT '${name}' AS name, md5(COALESCE(string_agg(h, '' ORDER BY h), '')) AS digest
        FROM (SELECT md5((${value})::text) AS h FROM ${name} t) rows`;
      })
      .join(" UNION ALL ") + " ORDER BY 1",
  );
}

/** "foreign key" for a key's own refusal, else the error's readable code. */
export function refusal(error: {
  code?: string;
  body?: { code?: string };
  cause?: { kind?: string };
  meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
}) {
  const postgresCode = error.meta?.driverAdapterError?.cause?.originalCode;
  return error.code === "P2003" ||
    postgresCode === "23001" ||
    postgresCode === "23503"
    ? "foreign key"
    : (error.body?.code ?? error.cause?.kind ?? error.code);
}
