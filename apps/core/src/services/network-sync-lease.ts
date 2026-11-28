import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { v7 as uuidv7 } from "uuid";
import { getEnv } from "@/config/env";
import type { NetworkDb, NetworkScope, SharedDb } from "@/lib/db/network-scope";
import { networkKey } from "@/lib/network";
import { DetachedNetworkRefusal } from "@/lib/soko-bot/detached-network-refusal";
import type { AcquiredSyncLock } from "@/services/sync-lock.service";

export class SyncLeaseLost extends Error {}

export function isNetworkSyncRefusal(error: unknown): boolean {
  return (
    error instanceof SyncLeaseLost || error instanceof DetachedNetworkRefusal
  );
}

interface Cursor {
  cursorId: string | null;
  lastSyncedAt: Date;
}

export function networkSyncLease(
  scope: NetworkScope,
  lock: AcquiredSyncLock,
  generation: number | null,
) {
  const conflict = "Preprod changed during the scheduled sync";
  function heldLease() {
    // Lock before reading the clock: even the wait for a competing row
    // lock can outlast the lease. A takeover waits until this write commits.
    return PrismaRaw.sql`owner AS MATERIALIZED (
            SELECT "lockedAt" FROM ${sharedTable("Lock")}
            WHERE "key" = ${lock.key} AND "isLocked" AND "lockedBy" = ${lock.ownerToken}
            FOR UPDATE
          ), held AS MATERIALIZED (
            SELECT 1 FROM owner WHERE "lockedAt" >=
              (clock_timestamp() AT TIME ZONE 'UTC') - ${getEnv().LOCK_TIMEOUT} * interval '1 millisecond'
          )`;
  }

  function requireHeld(rows: { held: boolean }[]) {
    if (!rows[0]?.held)
      throw new SyncLeaseLost("Scheduled sync lease expired or changed owner");
  }

  async function stamp(tx: NetworkDb | SharedDb) {
    if (scope.network === "mainnet") return;
    const { networkStamp } = await import("@/helpers/preprod-control");
    await networkStamp(
      { network: scope.network, expectedPreprodGeneration: generation },
      tx,
    );
    requireHeld(
      await tx.$queryRaw<{ held: boolean }[]>`
      WITH ${heldLease()}
      SELECT EXISTS (SELECT FROM held) AS held`,
    );
  }

  function write<T>(work: (db: NetworkDb) => Promise<T>): Promise<T> {
    if (scope.network === "mainnet") return work(scope.networkDb);
    return scope.netTransaction(async (tx) => {
      await stamp(tx);
      return work(tx);
    }, conflict);
  }

  function writeShared<T>(work: (db: SharedDb) => Promise<T>): Promise<T> {
    if (scope.network === "mainnet") return work(scope.sharedDb);
    return scope.sharedTransaction(async (tx) => {
      await stamp(tx);
      return work(tx);
    }, conflict);
  }

  const cursorKey = (name: string) => networkKey(scope.network, name);
  return {
    network: scope.network,
    stamp,
    write,
    writeShared,
    cursorKey,
    /** Pass null to remove the cursor, including on manual replay. */
    async writeCursor(name: string, cursor: Cursor | null): Promise<void> {
      const key = cursorKey(name);
      const metadata = sharedTable("sync_metadata");
      const mutation =
        cursor === null
          ? PrismaRaw.sql`DELETE FROM ${metadata} USING held WHERE "key" = ${key}`
          : PrismaRaw.sql`
          INSERT INTO ${metadata} ("id", "key", "cursorId", "lastSyncedAt", "updatedAt")
          SELECT ${uuidv7()}, ${key}, ${cursor.cursorId}::text, ${cursor.lastSyncedAt}::timestamp, clock_timestamp() AT TIME ZONE 'UTC'
          FROM held
          ON CONFLICT ("key") DO UPDATE SET "cursorId" = EXCLUDED."cursorId",
            "lastSyncedAt" = EXCLUDED."lastSyncedAt", "updatedAt" = EXCLUDED."updatedAt"`;
      async function persist(db: SharedDb) {
        requireHeld(
          await db.$queryRaw<{ held: boolean }[]>`
          WITH ${heldLease()}, changed AS (${mutation})
          SELECT EXISTS (SELECT FROM held) AS held`,
        );
      }
      await writeShared(persist);
    },
  };
}
