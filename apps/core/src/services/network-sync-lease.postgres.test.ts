import { describe, expect, it, vi } from "vitest";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

describe.runIf(enabled)("the registry cursor ID", () => {
  it.each(["real", "same millisecond"] as const)(
    "pins UUID version, time and insertion order under a %s clock",
    async (clock) => {
      const { createNetworkScope } = await import("@/lib/db/network-scope");
      const { networkSyncLease } = await import("./network-sync-lease");
      const { syncLockService } = await import("./sync-lock.service");
      const scope = createNetworkScope("mainnet");
      const lock = await syncLockService.acquireLock("cursor-id-pin");
      const lease = networkSyncLease(scope, lock, null);
      const table = scope.sharedDb.syncMetadata;
      const cursor = { cursorId: null, lastSyncedAt: new Date(0) };
      if (clock === "same millisecond") vi.useFakeTimers({ toFake: ["Date"] });
      try {
        for (const version of ["base", "head"]) {
          const prefix = `cursor-id-pin:${version}:`;
          try {
            for (let index = 0; index < 1000; index++) {
              const key = prefix + String(index).padStart(4, "0");
              if (version === "base") {
                await table.upsert({
                  where: { key },
                  create: { key, ...cursor },
                  update: cursor,
                });
              } else {
                await lease.writeCursor(key, cursor);
              }
            }
            const rows = await table.findMany({
              where: { key: { startsWith: prefix } },
              select: { id: true, createdAt: true },
              orderBy: { key: "asc" },
            });
            expect(rows).toHaveLength(1000);
            const ids = rows.map(({ id }) => id);
            const invalidVersion = ids.filter((id) => id[14] !== "7").length;
            const afterCreation = rows.filter(
              ({ id, createdAt }) =>
                Number.parseInt(id.slice(0, 13).replace("-", ""), 16) >
                createdAt.getTime(),
            ).length;
            const sorted = ids.toSorted();
            const outOfOrder = ids.filter(
              (id, index) => id !== sorted[index],
            ).length;
            expect(
              { invalidVersion, afterCreation, outOfOrder },
              version,
            ).toEqual({
              invalidVersion: 0,
              afterCreation: 0,
              outOfOrder: 0,
            });
          } finally {
            await table.deleteMany({ where: { key: { startsWith: prefix } } });
          }
        }
      } finally {
        vi.useRealTimers();
        await syncLockService.releaseLock(lock.key, lock.ownerToken);
        await scope.sharedDb.lock.delete({ where: { key: lock.key } });
      }
    },
    60_000,
  );
});

it.skipIf(!enabled)(
  "holds the lease row while a cursor write waits on a different connection",
  async () => {
    const { sharedTable } = await import("@sokosumi/database/sql-tables");
    const { getEnv } = await import("@/config/env");
    const { createNetworkScope } = await import("@/lib/db/network-scope");
    const { networkSyncLease, SyncLeaseLost } = await import(
      "./network-sync-lease"
    );
    const { syncLockService } = await import("./sync-lock.service");
    const scope = createNetworkScope("mainnet");
    const db = scope.sharedDb;
    const key = "cursor-row-lock-fence";
    const lock = await syncLockService.acquireLock(key);
    const lease = networkSyncLease(scope, lock, null);
    const lastSyncedAt = new Date(0);
    await lease.writeCursor(key, { cursorId: "seed", lastSyncedAt });
    const blockedBy = async (pid: number) =>
      (
        await db.$queryRaw<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND ${pid} = ANY (pg_blocking_pids(pid))`
      ).map((row) => row.pid);
    const rowHeld = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const blocker = scope.sharedTransaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`
      SELECT pg_backend_pid() AS pid FROM ${sharedTable("sync_metadata")}
      WHERE "key" = ${key} FOR UPDATE`;
      rowHeld.resolve(row.pid);
      await release.promise;
    }, "The fixture could not hold the cursor row");
    let writer: ReturnType<typeof lease.writeCursor> | undefined;
    let takeover: ReturnType<typeof syncLockService.acquireLock> | undefined;
    try {
      const blockerPid = await rowHeld.promise;
      writer = lease.writeCursor(key, { cursorId: "first", lastSyncedAt });
      await expect.poll(() => blockedBy(blockerPid)).toHaveLength(1);
      const [writerPid] = await blockedBy(blockerPid);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + getEnv().LOCK_TIMEOUT + 1);
      takeover = syncLockService.acquireLock(key);
      // The takeover must be waiting on the writer's row lock, not on the cursor.
      await expect.poll(() => blockedBy(writerPid)).toHaveLength(1);
      release.resolve();
      await writer;
      const successor = await takeover;
      expect(
        (await db.syncMetadata.findUniqueOrThrow({ where: { key } })).cursorId,
      ).toBe("first");
      await expect(lease.writeCursor(key, null)).rejects.toBeInstanceOf(
        SyncLeaseLost,
      );
      await expect(
        lease.writeCursor(key, { cursorId: "stale", lastSyncedAt }),
      ).rejects.toBeInstanceOf(SyncLeaseLost);
      await networkSyncLease(scope, successor, null).writeCursor(key, {
        cursorId: "successor",
        lastSyncedAt,
      });
      expect(
        (await db.syncMetadata.findUniqueOrThrow({ where: { key } })).cursorId,
      ).toBe("successor");
    } finally {
      vi.useRealTimers();
      release.resolve();
      await Promise.allSettled([blocker, writer, takeover]);
      await db.syncMetadata.delete({ where: { key } });
      await db.lock.delete({ where: { key } });
    }
  },
  15_000,
);
