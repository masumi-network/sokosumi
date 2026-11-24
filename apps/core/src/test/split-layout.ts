import { networkLayoutSchema } from "../config/network-layout";

/**
 * The schema names of this run, read the way Core reads them: blank means
 * `public`, and a mixed layout throws.
 */
export function testSchemaNames() {
  return networkLayoutSchema.parse(process.env);
}

// `vitest.config.ts` reads this too, before setup.ts clears the names of a
// unit run, so a mixed layout in the shell must not throw here.
const layout = networkLayoutSchema.safeParse(process.env);

/**
 * True in a PostgreSQL run on the new layout: a real database and three
 * different schema names, none `public` (CI's `Test Core PostgreSQL split
 * layout`). A test of Preprod behaviour runs only there, under
 * `describe.runIf(onSplitLayout)`: on today's layout Preprod's schema is
 * Mainnet's. The split job refuses to start without it
 * (`SPLIT_LAYOUT_RUN` in `vitest.config.ts`), so there such a test cannot skip.
 */
export const onSplitLayout =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL?.startsWith("postgres")) &&
  layout.success &&
  layout.data.DATABASE_SCHEMA_SHARED !== "public";
