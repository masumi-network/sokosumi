import { networkLayoutSchema } from "../config/network-layout";
import { isSplitLayout } from "./split-layout-pending";

/**
 * The schema names of this run, read the way Core reads them: blank means
 * `public`, and a mixed layout throws.
 */
export function testSchemaNames() {
  return networkLayoutSchema.parse(process.env);
}

/**
 * True in a PostgreSQL run on the new layout: a real database and three
 * different schema names, none `public` (CI's `Test Core PostgreSQL split
 * layout`). A test of Preprod behaviour runs only there, under
 * `describe.runIf(onSplitLayout)`: on today's layout Preprod's schema is
 * Mainnet's. The split job refuses to start without it
 * (`SPLIT_LAYOUT_RUN` in `vitest.config.ts`), so there such a test cannot skip.
 */
export const onSplitLayout = isSplitLayout(process.env);
