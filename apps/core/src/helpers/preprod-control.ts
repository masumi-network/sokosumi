import type { Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { v7 as uuidv7 } from "uuid";

import { serviceUnavailable } from "@/helpers/error";
import {
  preprodAccessOf,
  recordPreprodAccessChange,
} from "@/helpers/preprod-access";
import { isPrismaTransactionConflict } from "@/helpers/prisma";
import { databaseNow } from "@/lib/db/database-now";
import prisma, { type DbClient } from "@/lib/db/prisma";
import { recordCoreError } from "@/lib/evlog";
import type { Network } from "@/lib/network";

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
/** Canonical decimal text of a non-negative integer, as the raise writes it. */
const GENERATION_TEXT = /^(?:0|[1-9][0-9]*)$/;

/**
 * Preprod's control in one of three states:
 * - `open`: Preprod work may run; new work is stamped with `generation`.
 * - `paused`: an operator paused it, or nobody opened it yet. A cron tick
 *   skips (ticket 23); `generation` is still known, so work stamped with a
 *   different one is stale for good (ticket 24).
 * - `unavailable`: the read failed or a stored value is not valid. A cron
 *   tick skips; a callback answers with a retry and never drops work, because
 *   no generation is known to compare with (ticket 24).
 * Only `open` lets Preprod work run.
 */
export type PreprodControl =
  | { state: "open"; generation: number }
  | { state: "paused"; generation: number }
  | { state: "unavailable" };

type KnownPreprodControl = Exclude<PreprodControl, { state: "unavailable" }>;

/** One statement for both rows. Throws on a failed read or an invalid value. */
async function readControl(db: DbClient): Promise<KnownPreprodControl> {
  return controlOf(
    await db.syncMetadata.findMany({
      where: { key: { in: [PREPROD_PAUSE_KEY, PREPROD_GENERATION_KEY] } },
      select: { key: true, cursorId: true },
    }),
  );
}

function controlOf(
  rows: { key: string; cursorId: string | null }[],
): KnownPreprodControl {
  const row = (key: string) => rows.find((candidate) => candidate.key === key);
  const stored = row(PREPROD_GENERATION_KEY);
  // 0 only for a missing row: a row with no or other text is not a count.
  const generation = stored ? Number(stored.cursorId) : 0;
  if (
    stored &&
    !(
      GENERATION_TEXT.test(stored.cursorId ?? "") &&
      Number.isSafeInteger(generation)
    )
  ) {
    throw new Error(
      `Preprod generation is not a count: ${JSON.stringify(stored.cursorId)}`,
    );
  }
  // Fail closed: only the word "open" opens Preprod; no row is paused.
  return row(PREPROD_PAUSE_KEY)?.cursorId === OPEN
    ? { state: "open", generation }
    : { state: "paused", generation };
}

/** Preprod's control, read now. A failed read is `unavailable`, and recorded. */
export async function readPreprodControl(
  db: DbClient = prisma,
): Promise<PreprodControl> {
  try {
    return await readControl(db);
  } catch (error) {
    recordCoreError(
      { operation: "read_preprod_control" },
      { ...UNREADABLE, cause: error },
    );
    return { state: "unavailable" };
  }
}

const UNREADABLE = {
  message: "Could not read the Preprod pause and generation",
  why: "The database read failed, or a stored value is not valid",
  fix: `Preprod work waits until the read works. Read error.cause; check the ${PREPROD_PAUSE_KEY} and ${PREPROD_GENERATION_KEY} rows in sync_metadata.`,
};

/**
 * The `network` of a new row that work resumes from later (a Soko Bot turn,
 * delegation or schedule, a chat mention), with the Preprod generation it
 * starts under. A Mainnet row gets no generation and reads nothing. A Preprod
 * row is written only while Preprod is open: paused or unavailable throws a
 * retryable 503, so no Preprod row exists without its generation.
 *
 * `tx` is the transaction that writes the row. The pause row is the only
 * fence: the stamp locks it `FOR SHARE` until the write commits, and every
 * operator action (pause, open, raise) updates it first (`fencePause`). So
 * the row commits before the action, or waits for it: then a Read Committed
 * writer reads the new values in the next statement, and a serializable one
 * fails with 40001 and its transaction retries. The generation is read in a
 * second statement, unlocked, so there is one lock order everywhere (pause,
 * then generation). A transaction conflict is rethrown for the caller's
 * retry; any other failed read is the unavailable 503.
 */
export async function networkStamp(
  network: Network,
  tx: Prisma.TransactionClient,
): Promise<{ network: Network; preprodGeneration?: number }> {
  if (network === "mainnet") return { network };
  let control: KnownPreprodControl;
  try {
    const pause = await tx.$queryRaw<
      { key: string; cursorId: string | null }[]
    >`
      SELECT "key", "cursorId" FROM ${sharedTable("sync_metadata")}
      WHERE "key" = ${PREPROD_PAUSE_KEY}
      FOR SHARE`;
    const generation = await tx.$queryRaw<
      { key: string; cursorId: string | null }[]
    >`
      SELECT "key", "cursorId" FROM ${sharedTable("sync_metadata")}
      WHERE "key" = ${PREPROD_GENERATION_KEY}`;
    control = controlOf([...pause, ...generation]);
  } catch (error) {
    if (isPrismaTransactionConflict(error)) throw error;
    recordCoreError(
      { operation: "read_preprod_control" },
      { ...UNREADABLE, cause: error },
    );
    // Recorded above; a planned refusal is no Sentry Issue.
    throw serviceUnavailable(
      "Preprod's state could not be read; try again later",
      { reportToSentry: false },
    );
  }
  if (control.state !== "open") {
    // An operator's pause: planned, so no Sentry Issue.
    throw serviceUnavailable("Preprod is paused; try again later", {
      reportToSentry: false,
    });
  }
  return { network, preprodGeneration: control.generation };
}

/**
 * The fence every operator action takes first: the pause row exists (a
 * missing row is paused, so it is created as paused) and is really updated,
 * a no-op that changes no value. The update, not only a lock, is what makes
 * a serializable writer that read the row before fail with 40001.
 */
async function fencePause(tx: Prisma.TransactionClient) {
  await tx.syncMetadata.createMany({
    data: {
      key: PREPROD_PAUSE_KEY,
      cursorId: PAUSED,
      lastSyncedAt: await databaseNow(tx),
    },
    skipDuplicates: true,
  });
  await tx.$executeRaw`
    UPDATE ${sharedTable("sync_metadata")} SET "cursorId" = "cursorId"
    WHERE "key" = ${PREPROD_PAUSE_KEY}`;
}

/**
 * The pause and generation with the 20 most recent pause changes, newest
 * first. Throws when the value cannot be read, so a route answers 500.
 */
export async function preprodControlOf(db: DbClient) {
  const control = await readControl(db);
  const paused = control.state === "paused";
  const { changes } = await preprodAccessOf(db, PAUSE_TARGET, !paused);
  return {
    paused,
    generation: control.generation,
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
 * reads as paused. The pause row stays locked until the commit, a repeat
 * included, so two switches at once run one after the other: two equal ones
 * record one change, and each answer is one moment's state and history.
 */
export function setPreprodPaused(input: {
  paused: boolean;
  operatorId: string;
  reason: string;
}) {
  const { paused, operatorId, reason } = input;
  const value = paused ? PAUSED : OPEN;
  return prisma.$transaction(async (tx) => {
    // The fence creates a missing row as paused: the update below then
    // decides alone whether anything changes.
    await fencePause(tx);
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
    return preprodControlOf(tx);
  });
}

/**
 * Raises the generation by one and returns the new number; the first raise
 * gives 1. One statement under the row's lock, so two raises at once give two
 * numbers. A stored value the reader would not accept (not canonical decimal
 * text, or at the safe-integer limit) is left as it is, and the raise throws.
 * The pause row is fenced first (`fencePause`), so a Preprod row being
 * written (`networkStamp`) commits before the raise or sees the new number.
 * Called by the wipe (ticket 41), by no route.
 */
export async function raisePreprodGeneration(): Promise<number> {
  const [row] = await prisma.$transaction(async (tx) => {
    await fencePause(tx);
    // The CASE keeps the cast from running on text that is not a count.
    return tx.$queryRaw<{ generation: string }[]>`
    INSERT INTO ${sharedTable("sync_metadata")} AS m ("id", "key", "cursorId", "lastSyncedAt", "updatedAt")
    VALUES (
      ${uuidv7()},
      ${PREPROD_GENERATION_KEY},
      '1',
      clock_timestamp() AT TIME ZONE 'UTC',
      clock_timestamp() AT TIME ZONE 'UTC'
    )
    ON CONFLICT ("key") DO UPDATE SET
      "cursorId" = (m."cursorId"::bigint + 1)::text,
      "lastSyncedAt" = EXCLUDED."lastSyncedAt",
      "updatedAt" = EXCLUDED."updatedAt"
    WHERE CASE
      WHEN m."cursorId" ~ '^(0|[1-9][0-9]{0,15})$'
        THEN m."cursorId"::bigint < ${Number.MAX_SAFE_INTEGER}
      ELSE false
    END
    RETURNING m."cursorId" AS generation`;
  });
  if (!row) {
    throw new Error(
      "The stored Preprod generation is not a count; it was not raised",
    );
  }
  return Number(row.generation);
}
