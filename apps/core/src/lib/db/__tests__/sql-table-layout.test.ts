import {
  createSqlTables,
  type SqlTableLayout,
} from "@sokosumi/database/sql-tables";
import { describe, expect, it } from "vitest";

import { networkLayoutSchema } from "@/config/network-layout";

// The database package cannot import Core's layout rule, so `createSqlTables`
// repeats it. Both get the same layouts here and must agree, except where a
// row says they differ on purpose.
interface Row {
  name: string;
  shared: unknown;
  mainnet: unknown;
  preprod: unknown;
  preprodOn: boolean;
  core: boolean;
  /** Set where the helper decides differently, with the reason as the name. */
  helper?: boolean;
}

const LONG = "n".repeat(63);

const ROWS: Row[] = [
  {
    name: "today's layout",
    shared: "public",
    mainnet: "public",
    preprod: "public",
    preprodOn: false,
    core: true,
  },
  {
    name: "the split layout, Preprod on",
    shared: "shared",
    mainnet: "mainnet",
    preprod: "preprod",
    preprodOn: true,
    core: true,
  },
  {
    name: "the split layout, Preprod off",
    shared: "shared",
    mainnet: "mainnet",
    preprod: "preprod",
    preprodOn: false,
    core: true,
  },
  {
    name: "a 63-character name",
    shared: "shared",
    mainnet: LONG,
    preprod: "preprod",
    preprodOn: true,
    core: true,
  },
  {
    name: "Preprod on today's layout",
    shared: "public",
    mainnet: "public",
    preprod: "public",
    preprodOn: true,
    core: false,
  },
  {
    name: "Preprod in Mainnet's schema",
    shared: "shared",
    mainnet: "mainnet",
    preprod: "mainnet",
    preprodOn: false,
    core: false,
  },
  {
    name: "Preprod in public",
    shared: "shared",
    mainnet: "mainnet",
    preprod: "public",
    preprodOn: true,
    core: false,
  },
  {
    name: "Mainnet in public, the rest split",
    shared: "shared",
    mainnet: "public",
    preprod: "preprod",
    preprodOn: false,
    core: false,
  },
  {
    name: "shared in public, the rest split",
    shared: "public",
    mainnet: "mainnet",
    preprod: "preprod",
    preprodOn: false,
    core: false,
  },
  {
    name: "Preprod in the shared schema",
    shared: "shared",
    mainnet: "mainnet",
    preprod: "shared",
    preprodOn: true,
    core: false,
  },
  {
    name: "only shared moved",
    shared: "shared",
    mainnet: "public",
    preprod: "public",
    preprodOn: false,
    core: false,
  },
  {
    name: "two names PostgreSQL cuts to one",
    shared: "shared",
    mainnet: `${LONG}a`,
    preprod: `${LONG}b`,
    preprodOn: true,
    core: false,
  },
  {
    name: "an uppercase name",
    shared: "shared",
    mainnet: "Mainnet",
    preprod: "preprod",
    preprodOn: true,
    core: false,
  },
  {
    name: "a quote in a name",
    shared: 'sha"red',
    mainnet: "mainnet",
    preprod: "preprod",
    preprodOn: true,
    core: false,
  },
  {
    name: "a dot in a name",
    shared: "shared",
    mainnet: "main.net",
    preprod: "preprod",
    preprodOn: true,
    core: false,
  },
  {
    name: "a system schema",
    shared: "shared",
    mainnet: "pg_catalog",
    preprod: "preprod",
    preprodOn: true,
    core: false,
  },
  {
    name: "information_schema",
    shared: "information_schema",
    mainnet: "mainnet",
    preprod: "preprod",
    preprodOn: true,
    core: false,
  },
  {
    name: "a number as a name",
    shared: "shared",
    mainnet: 42,
    preprod: "preprod",
    preprodOn: true,
    core: false,
  },
  {
    name: "pg_temp as the shared schema",
    shared: "pg_temp",
    mainnet: "public",
    preprod: "public",
    preprodOn: false,
    core: false,
  },
  {
    name: "differs: a blank name is unset in Core's env and becomes public, the helper takes parsed names only",
    shared: "",
    mainnet: "",
    preprod: "",
    preprodOn: false,
    core: true,
    helper: false,
  },
];

function coreAccepts(row: Row): boolean {
  return networkLayoutSchema.safeParse({
    DATABASE_SCHEMA_SHARED: row.shared,
    DATABASE_SCHEMA_MAINNET: row.mainnet,
    DATABASE_SCHEMA_PREPROD: row.preprod,
    NETWORK_PREPROD_ENABLED: String(row.preprodOn),
  }).success;
}

function helperAccepts({ shared, mainnet, preprod, preprodOn }: Row): boolean {
  try {
    createSqlTables({ shared, mainnet, preprod, preprodOn } as SqlTableLayout);
    return true;
  } catch {
    return false;
  }
}

describe("the layout rule in Core and in the SQL table helper", () => {
  it.each(ROWS)("$name", (row) => {
    expect(coreAccepts(row)).toBe(row.core);
    expect(helperAccepts(row)).toBe(row.helper ?? row.core);
  });
});
