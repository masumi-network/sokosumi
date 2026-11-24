/**
 * True in a PostgreSQL run on the new layout: a real database and three
 * different schema names, none `public` (CI's `Test Core PostgreSQL split
 * layout`). A test of Preprod behaviour runs only there, under
 * `describe.runIf(onSplitLayout)`: on today's layout Preprod's schema is
 * Mainnet's.
 */
const names = [
  process.env.DATABASE_SCHEMA_SHARED,
  process.env.DATABASE_SCHEMA_MAINNET,
  process.env.DATABASE_SCHEMA_PREPROD,
];

export const onSplitLayout =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres")) &&
  new Set(names).size === names.length &&
  names.every((name) => name && name !== "public");
