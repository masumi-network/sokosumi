import { raw, type Sql } from "@prisma/client/runtime/client";
import networkTables from "../prisma/network-tables.json" with { type: "json" };
import { $Enums } from "./index.js";

/**
 * Table and enum type names for raw SQL, always with their schema:
 * `"<schema>"."<name>"`, also while the schema is `public`. Raw SQL never
 * relies on the search path (the clients share one pool). A table is named by
 * its SQL name, as the statement would write it (`jobEvent`, not the model
 * `JobEvent`); which side a table or enum is on comes from
 * `prisma/network-tables.json`.
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
  sharedTable(table: string): Sql;
  /**
   * A Network's table. Throws for a `shared` table, an unknown name, an
   * unknown Network, and for Preprod while it is off: on today's layout that
   * would name Mainnet's rows.
   */
  netTable(network: TableNetwork, table: string): Sql;
  /** A `shared` enum type, for a cast: `${value}::${sharedType("TaskStatus")}`. */
  sharedType(type: string): Sql;
  /** A Network's enum type. Refuses what `netTable` refuses. */
  netType(network: TableNetwork, type: string): Sql;
}

interface Names {
  kind: "table" | "type";
  shared: ReadonlySet<string>;
  network: ReadonlySet<string>;
}

const TABLES: Names = {
  kind: "table",
  shared: new Set(Object.values(networkTables.shared)),
  network: new Set([
    ...Object.values(networkTables.network),
    ...networkTables.networkJoinTables,
  ]),
};
// An enum lives beside the tables that use it; every other enum is shared.
const TYPES: Names = {
  kind: "type",
  shared: new Set(
    Object.keys($Enums).filter(
      (name) => !networkTables.networkEnums.includes(name),
    ),
  ),
  network: new Set(networkTables.networkEnums),
};

/**
 * Quoting needs no escaping, because anything but a plain identifier is
 * refused. PostgreSQL cuts an identifier at 63 bytes, quoted or not, so two
 * longer names could be one object.
 */
function quoted(identifier: string): string {
  if (
    typeof identifier !== "string" ||
    identifier.length > 63 ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)
  ) {
    throw new Error(
      `Not a plain SQL identifier: ${JSON.stringify(identifier)}`,
    );
  }
  return `"${identifier}"`;
}

/**
 * The rule of Core's `config/network-layout.ts`, which this package cannot
 * import (`apps/core/src/lib/db/__tests__/sql-table-layout.test.ts` holds the
 * two together): lowercase names, no PostgreSQL system schema; all three
 * `public`, or all different and none `public`; Preprod on only on the split.
 */
function checkLayout({
  shared,
  mainnet,
  preprod,
  preprodOn,
}: SqlTableLayout): void {
  if (typeof preprodOn !== "boolean") {
    throw new Error("preprodOn must be true or false");
  }
  const names = [shared, mainnet, preprod];
  for (const name of names) {
    quoted(name);
    if (
      name !== name.toLowerCase() ||
      name.startsWith("pg_") ||
      name === "information_schema"
    ) {
      throw new Error(`Not a schema name for tables: ${JSON.stringify(name)}`);
    }
  }
  const split =
    new Set(names).size === names.length &&
    names.every((name) => name !== "public");
  if (!split && !names.every((name) => name === "public")) {
    throw new Error(
      "The schema names must be all public, or all different and none public",
    );
  }
  if (preprodOn && !split) {
    throw new Error(
      "Preprod can be on only while the schema names are all different and none is public",
    );
  }
}

/**
 * The helpers for one layout: the schema names of the process that owns the
 * configuration, or a test's own. Throws for a layout Core would refuse.
 *
 * The fragments are raw SQL text, not parameters. That is safe because no part
 * of them is input: the schema names are deployment configuration, a table or
 * type must be on the checked-in list, and all must be plain identifiers.
 */
export function createSqlTables(layout: SqlTableLayout): SqlTables {
  // Read once: what is checked is what is quoted, whatever the object does
  // on a second read.
  const { shared: sharedSchema, mainnet, preprod, preprodOn } = layout;
  checkLayout({ shared: sharedSchema, mainnet, preprod, preprodOn });
  const schemas = {
    shared: quoted(sharedSchema),
    mainnet: quoted(mainnet),
    preprod: quoted(preprod),
  };

  function shared({ kind, shared, network }: Names, name: string): Sql {
    if (network.has(name)) {
      throw new Error(
        `${name} is a Network ${kind}: use ${kind === "table" ? "netTable" : "netType"}`,
      );
    }
    if (!shared.has(name)) throw new Error(`Unknown ${kind}: ${name}`);
    return raw(`${schemas.shared}.${quoted(name)}`);
  }

  function net(
    { kind, shared, network: own }: Names,
    network: TableNetwork,
    name: string,
  ): Sql {
    if (network !== "mainnet" && network !== "preprod") {
      throw new Error(`Unknown Network: ${String(network)}`);
    }
    if (network === "preprod" && !preprodOn) {
      throw new Error("Preprod is off: no SQL may name its schema");
    }
    if (shared.has(name)) {
      throw new Error(
        `${name} is a shared ${kind}: use ${kind === "table" ? "sharedTable" : "sharedType"}`,
      );
    }
    if (!own.has(name)) throw new Error(`Unknown ${kind}: ${name}`);
    return raw(`${schemas[network]}.${quoted(name)}`);
  }

  return {
    sharedTable: (table) => shared(TABLES, table),
    netTable: (network, table) => net(TABLES, network, table),
    sharedType: (type) => shared(TYPES, type),
    netType: (network, type) => net(TYPES, network, type),
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
 * Sets the layout for the four functions below, which this package's own
 * statements use. Call it once at startup, before any query. Returns a
 * function that puts back the layout that was configured before: a test calls
 * it when it finishes.
 */
export function configureSqlTables(layout: SqlTableLayout): () => void {
  const before = configured;
  configured = createSqlTables(layout);
  return () => {
    configured = before;
  };
}

/** `SqlTables.sharedTable` on the configured layout. */
export function sharedTable(table: string): Sql {
  return configured.sharedTable(table);
}

/** `SqlTables.netTable` on the configured layout. */
export function netTable(network: TableNetwork, table: string): Sql {
  return configured.netTable(network, table);
}

/** `SqlTables.sharedType` on the configured layout. */
export function sharedType(type: string): Sql {
  return configured.sharedType(type);
}

/** `SqlTables.netType` on the configured layout. */
export function netType(network: TableNetwork, type: string): Sql {
  return configured.netType(network, type);
}
