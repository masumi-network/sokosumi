import type { Prisma } from "@sokosumi/database";

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
 * Runs a test fixture's writes in one transaction whose search path holds this
 * run's schemas (shared, then Mainnet). Some trigger bodies still name a table
 * or a function without its schema (ticket 19 part 2, the triggers that need
 * the row's Network): creating a Task or an image asset fires them, and on the
 * split layout they would not find `upsert_history_task` or
 * `upsert_history_image_asset`. Test fixtures only; production SQL names its
 * schemas.
 */
export async function withFixtureSchemas<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const names = testSchemaNames();
  const path = [
    ...new Set([names.DATABASE_SCHEMA_SHARED, names.DATABASE_SCHEMA_MAINNET]),
  ]
    .map((name) => `"${name}"`)
    .join(", ");
  // Loaded here: files that only ask `onSplitLayout` need no database client.
  const { default: prisma } = await import("../lib/db/prisma");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${path}`);
    return run(tx);
  });
}

class Rollback extends Error {}

/** Always roll back the fixture transaction and propagate test failures. */
export async function rolledBack(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await withFixtureSchemas(async (tx) => {
    await run(tx);
    throw new Rollback();
  }).catch((error) => {
    if (!(error instanceof Rollback)) throw error;
  });
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
