import { PrismaRaw } from "@sokosumi/database/client";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";

import { type Network, networksThatAreOn } from "@/lib/network";

import {
  NETWORK_TO_SHARED_KEYS,
  SHARED_TO_NETWORK_KEYS,
} from "./crossing-keys";
import type { DbClient } from "./prisma";

interface OrphanCount {
  network: Network;
  key: string;
  count: bigint;
}

function countOrphans(
  label: PrismaRaw.Sql,
  childTable: PrismaRaw.Sql,
  childColumn: string,
  parentTable: PrismaRaw.Sql,
  networkFilter = PrismaRaw.empty,
): PrismaRaw.Sql {
  const column = PrismaRaw.raw(`"${childColumn.replaceAll('"', '""')}"`);
  return PrismaRaw.sql`
    SELECT ${label}, count(*) AS count
    FROM ${childTable} c
    WHERE c.${column} IS NOT NULL ${networkFilter}
      AND NOT EXISTS (SELECT 1 FROM ${parentTable} p WHERE p.id = c.${column})
  `;
}

export function countCrossingKeyOrphans(db: DbClient): Promise<OrphanCount[]> {
  const queries = networksThatAreOn().flatMap((network) => [
    ...NETWORK_TO_SHARED_KEYS.map(([child, column, parent]) =>
      countOrphans(
        PrismaRaw.sql`${network}::text AS network, ${`${child}.${column}`}::text AS key`,
        netTable(network, child),
        column,
        sharedTable(parent),
      ),
    ),
    ...SHARED_TO_NETWORK_KEYS.map(
      ([child, column, parent, , , , , routing]) => {
        const label = PrismaRaw.sql`${network}::text AS network, ${`${child}.${column}`}::text AS key`;
        // These shared rows belong to Mainnet, so Preprod has none to check.
        if (routing === "mainnet" && network === "preprod") {
          return PrismaRaw.sql`SELECT ${label}, 0::bigint AS count`;
        }
        const filter =
          routing === "tagged"
            ? PrismaRaw.sql`AND COALESCE(c.network, 'mainnet') = ${network}`
            : PrismaRaw.empty;
        return countOrphans(
          label,
          sharedTable(child),
          column,
          netTable(network, parent),
          filter,
        );
      },
    ),
  ]);
  return db.$queryRaw<OrphanCount[]>(
    PrismaRaw.sql`${PrismaRaw.join(queries, " UNION ALL ")} ORDER BY network, key`,
  );
}
