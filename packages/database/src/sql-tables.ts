import networkTables from "../prisma/network-tables.json" with { type: "json" };
import { Prisma } from "./generated/prisma/client.js";

/**
 * Table names for raw SQL, always with their schema: `"<schema>"."<table>"`,
 * also while the schema is `public`. Raw SQL never relies on the search path
 * (the clients share one pool). A table is named by its SQL name, as the
 * statement would write it (`jobEvent`, not the model `JobEvent`); which side
 * it is on comes from `prisma/network-tables.json`.
 */

/** A Masumi Network: the two names a Network table can be asked for. */
export type TableNetwork = "mainnet" | "preprod";

/** The schema of each side, and whether Preprod is on (`NETWORK_PREPROD_ENABLED`). */
export interface SqlTableLayout {
  shared: string;
  mainnet: string;
  preprod: string;
  preprodOn: boolean;
}

export interface SqlTables {
  /** A `shared` table. Throws for a Network table or an unknown name. */
  sharedTable(table: string): Prisma.Sql;
  /**
   * A Network's table. Throws for a `shared` table, an unknown name, an
   * unknown Network, and for Preprod while it is off or its schema is
   * Mainnet's: on today's layout that would name Mainnet's rows.
   */
  netTable(network: TableNetwork, table: string): Prisma.Sql;
}

const SHARED_TABLES: ReadonlySet<string> = new Set(
  Object.values(networkTables.shared),
);
const NETWORK_TABLES: ReadonlySet<string> = new Set([
  ...Object.values(networkTables.network),
  ...networkTables.networkJoinTables,
]);

/** Quoting needs no escaping, because anything but a plain identifier is refused. */
function quoted(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(
      `Not a plain SQL identifier: ${JSON.stringify(identifier)}`,
    );
  }
  return `"${identifier}"`;
}

/**
 * The two helpers for one layout: the schema names of the process that owns
 * the configuration, or a test's own.
 *
 * The fragments are raw SQL text, not parameters. That is safe because no part
 * of them is input: the schema names are deployment configuration, a table
 * must be on the checked-in list, and both must be plain identifiers.
 */
export function createSqlTables(layout: SqlTableLayout): SqlTables {
  const { preprodOn } = layout;
  const schemas = {
    shared: quoted(layout.shared),
    mainnet: quoted(layout.mainnet),
    preprod: quoted(layout.preprod),
  };
  return {
    sharedTable(table) {
      if (NETWORK_TABLES.has(table)) {
        throw new Error(`${table} is a Network table: use netTable`);
      }
      if (!SHARED_TABLES.has(table)) {
        throw new Error(`Unknown table: ${table}`);
      }
      return Prisma.raw(`${schemas.shared}.${quoted(table)}`);
    },
    netTable(network, table) {
      if (network !== "mainnet" && network !== "preprod") {
        throw new Error(`Unknown Network: ${String(network)}`);
      }
      if (network === "preprod" && !preprodOn) {
        throw new Error("Preprod is off: no SQL may name its tables");
      }
      if (network === "preprod" && schemas.preprod === schemas.mainnet) {
        throw new Error(
          "Preprod's schema is Mainnet's: its tables would be Mainnet's rows",
        );
      }
      if (SHARED_TABLES.has(table)) {
        throw new Error(`${table} is a shared table: use sharedTable`);
      }
      if (!NETWORK_TABLES.has(table)) {
        throw new Error(`Unknown table: ${table}`);
      }
      return Prisma.raw(`${schemas[network]}.${quoted(table)}`);
    },
  };
}

/** Today's layout: every schema `public`, Preprod off. */
export const PUBLIC_LAYOUT: SqlTableLayout = {
  shared: "public",
  mainnet: "public",
  preprod: "public",
  preprodOn: false,
};

// Until the process that owns the configuration passes its names.
let configured = createSqlTables(PUBLIC_LAYOUT);

/**
 * Sets the layout for `sharedTable` and `netTable` below, which this
 * package's own statements use. Call it once at startup, before any query.
 */
export function configureSqlTables(layout: SqlTableLayout): void {
  configured = createSqlTables(layout);
}

/** `SqlTables.sharedTable` on the configured layout. */
export function sharedTable(table: string): Prisma.Sql {
  return configured.sharedTable(table);
}

/** `SqlTables.netTable` on the configured layout. */
export function netTable(network: TableNetwork, table: string): Prisma.Sql {
  return configured.netTable(network, table);
}
