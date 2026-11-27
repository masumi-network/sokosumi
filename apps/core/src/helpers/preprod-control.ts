import { sharedTable } from "@sokosumi/database/sql-tables";

import {
  preprodAccessOf,
  recordPreprodAccessChange,
} from "@/helpers/preprod-access";
import { databaseNow } from "@/lib/db/database-now";
import prisma, { type DbClient } from "@/lib/db/prisma";
import { tryUseLogger } from "@/lib/evlog";

/**
 * The Preprod pause and generation number: two `sync_metadata` rows on the
 * shared client, read on every call (no cache), so a switch takes effect
 * without a deploy. Outside the `preprod:` prefix, so the wipe's delete of
 * every `preprod:` key leaves both. Not the Preprod flag (`isPreprodOn()`).
 */
export const PREPROD_PAUSE_KEY = "network-pause:preprod";
export const PREPROD_GENERATION_KEY = "network-generation:preprod";

const OPEN = "open";
const PAUSED = "paused";
const PAUSE_TARGET = { type: "network", id: "preprod" } as const;

/**
 * Open Preprod always comes with its generation; a paused answer from a
 * failed read has none.
 */
export type PreprodControl =
  | { paused: false; generation: number }
  | { paused: true; generation: number | null };

/** One statement for both rows. Throws on a failed read. */
async function readControl(db: DbClient): Promise<PreprodControl> {
  const rows = await db.syncMetadata.findMany({
    where: { key: { in: [PREPROD_PAUSE_KEY, PREPROD_GENERATION_KEY] } },
    select: { key: true, cursorId: true },
  });
  const value = (key: string) => rows.find((row) => row.key === key)?.cursorId;
  const stored = value(PREPROD_GENERATION_KEY);
  const generation = stored == null ? 0 : Number(stored);
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error(`Preprod generation is not a count: ${stored}`);
  }
  // Fail closed: only the word "open" opens Preprod; no row is paused.
  return value(PREPROD_PAUSE_KEY) === OPEN
    ? { paused: false, generation }
    : { paused: true, generation };
}

/**
 * Whether Preprod is paused and its generation. A failed read is paused,
 * with no generation.
 */
export async function readPreprodControl(): Promise<PreprodControl> {
  try {
    return await readControl(prisma);
  } catch (error) {
    tryUseLogger()?.set({
      preprodControl: { readFailed: true, error: String(error) },
    });
    return { paused: true, generation: null };
  }
}

/** The pause and generation with the 20 most recent pause changes, newest first. */
export async function preprodControlOf(db: DbClient, control: PreprodControl) {
  const { changes } = await preprodAccessOf(db, PAUSE_TARGET, !control.paused);
  return {
    ...control,
    changes: changes.map(({ enabled, ...change }) => ({
      ...change,
      paused: !enabled,
    })),
  };
}

/**
 * Pauses or opens Preprod and records the change in one transaction, and
 * answers from that transaction, as `setPreprodAccess` does. A value the row
 * already holds changes nothing and records nothing; a missing row already
 * reads as paused. The condition is in the update, so two equal requests at
 * once record one change.
 */
export function setPreprodPaused(input: {
  paused: boolean;
  operatorId: string;
  reason: string;
}) {
  const { paused, operatorId, reason } = input;
  const value = paused ? PAUSED : OPEN;
  return prisma.$transaction(async (tx) => {
    // A missing row is paused, so it is created as paused: the update below
    // then decides alone whether anything changes.
    await tx.syncMetadata.createMany({
      data: {
        key: PREPROD_PAUSE_KEY,
        cursorId: PAUSED,
        lastSyncedAt: await databaseNow(tx),
      },
      skipDuplicates: true,
    });
    const { count } = await tx.syncMetadata.updateMany({
      where: {
        key: PREPROD_PAUSE_KEY,
        OR: [{ cursorId: { not: value } }, { cursorId: null }],
      },
      data: { cursorId: value },
    });
    if (count > 0) {
      await recordPreprodAccessChange(tx, PAUSE_TARGET, {
        enabled: !paused,
        operatorId,
        reason,
      });
    }
    return preprodControlOf(tx, await readControl(tx));
  });
}

/**
 * Raises the generation by one and returns the new number; the first raise
 * gives 1. One statement under the row's lock, so two raises at once give two
 * numbers. Called by the wipe (ticket 41), by no route.
 */
export async function raisePreprodGeneration(): Promise<number> {
  const table = sharedTable("sync_metadata");
  const [row] = await prisma.$queryRaw<{ generation: string }[]>`
    INSERT INTO ${table} AS m ("id", "key", "cursorId", "lastSyncedAt", "updatedAt")
    VALUES (
      gen_random_uuid()::text,
      ${PREPROD_GENERATION_KEY},
      '1',
      clock_timestamp() AT TIME ZONE 'UTC',
      clock_timestamp() AT TIME ZONE 'UTC'
    )
    ON CONFLICT ("key") DO UPDATE SET
      "cursorId" = (m."cursorId"::bigint + 1)::text,
      "lastSyncedAt" = EXCLUDED."lastSyncedAt",
      "updatedAt" = EXCLUDED."updatedAt"
    RETURNING m."cursorId" AS generation`;
  if (!row) throw new Error("Raising the Preprod generation returned no row");
  return Number(row.generation);
}
