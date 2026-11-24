import {
  createSqlTables,
  type SqlTableLayout,
} from "@sokosumi/database/sql-tables";
import { describe, expect, it } from "vitest";

import { networkLayoutSchema } from "@/config/network-layout";

// The database package cannot import Core's layout rule, so `createSqlTables`
// repeats it. Both get the same layouts here and must agree, except where a
// case says they differ on purpose.
type Layout = Record<keyof SqlTableLayout, unknown>;

const PUBLIC: Layout = {
  shared: "public",
  mainnet: "public",
  preprod: "public",
  preprodOn: false,
};
const SPLIT: Layout = {
  shared: "shared",
  mainnet: "mainnet",
  preprod: "preprod",
  preprodOn: true,
};
const LONG = "n".repeat(63);

// [what, the base layout, what the case changes, Core accepts, the helper accepts if it differs]
const CASES: [string, Layout, Partial<Layout>, boolean, boolean?][] = [
  ["today's layout", PUBLIC, {}, true],
  ["the split layout, Preprod on", SPLIT, {}, true],
  ["the split layout, Preprod off", SPLIT, { preprodOn: false }, true],
  ["a 63-character name", SPLIT, { mainnet: LONG }, true],
  ["Preprod on today's layout", PUBLIC, { preprodOn: true }, false],
  ["only shared moved", PUBLIC, { shared: "shared" }, false],
  ["Preprod in Mainnet's schema", SPLIT, { preprod: "mainnet" }, false],
  ["Preprod in public", SPLIT, { preprod: "public" }, false],
  ["Preprod in the shared schema", SPLIT, { preprod: "shared" }, false],
  ["Mainnet in public", SPLIT, { mainnet: "public" }, false],
  ["Mainnet in the shared schema", SPLIT, { mainnet: "shared" }, false],
  ["shared in public", SPLIT, { shared: "public" }, false],
  [
    "all three the same, not public",
    SPLIT,
    { mainnet: "shared", preprod: "shared" },
    false,
  ],
  [
    "two names PostgreSQL cuts to one",
    SPLIT,
    { mainnet: `${LONG}a`, preprod: `${LONG}b` },
    false,
  ],
  ["an uppercase name", SPLIT, { mainnet: "Mainnet" }, false],
  ["a quote in a name", SPLIT, { shared: 'sha"red' }, false],
  ["a dot in a name", SPLIT, { mainnet: "main.net" }, false],
  ["a hyphen in a name", SPLIT, { mainnet: "main-net" }, false],
  ["a leading digit", SPLIT, { mainnet: "1mainnet" }, false],
  ["a system schema", SPLIT, { mainnet: "pg_catalog" }, false],
  ["pg_temp", PUBLIC, { shared: "pg_temp" }, false],
  ["information_schema", SPLIT, { shared: "information_schema" }, false],
  ["a number as a name", SPLIT, { mainnet: 42 }, false],
  // Core reads the environment: a missing or blank name is unset and becomes
  // `public`. The helper takes parsed names only.
  [
    "differs: undefined names",
    PUBLIC,
    { shared: undefined, mainnet: undefined, preprod: undefined },
    true,
    false,
  ],
  [
    "differs: blank names",
    PUBLIC,
    { shared: "", mainnet: "", preprod: "" },
    true,
    false,
  ],
];

function coreAccepts(layout: Layout): boolean {
  return networkLayoutSchema.safeParse({
    DATABASE_SCHEMA_SHARED: layout.shared,
    DATABASE_SCHEMA_MAINNET: layout.mainnet,
    DATABASE_SCHEMA_PREPROD: layout.preprod,
    NETWORK_PREPROD_ENABLED: String(layout.preprodOn),
  }).success;
}

function helperAccepts(layout: Layout): boolean {
  try {
    createSqlTables(layout as SqlTableLayout);
    return true;
  } catch {
    return false;
  }
}

describe("the layout rule in Core and in the SQL table helper", () => {
  it.each(CASES)("%s", (_what, base, change, core, helper = core) => {
    const layout = { ...base, ...change };
    expect(coreAccepts(layout)).toBe(core);
    expect(helperAccepts(layout)).toBe(helper);
  });
});
