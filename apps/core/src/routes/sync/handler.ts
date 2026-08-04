import { waitUntil } from "@vercel/functions";
import type { Context } from "hono";

import { getEnv } from "@/config/env";
import type { AcquiredSyncLock } from "@/services/sync-lock.service";
import { syncLockService } from "@/services/sync-lock.service";

export interface SyncExecutionContext {
  abortSignal: AbortSignal;
  deadlineMs: number;
  msRemaining: () => number;
  shouldContinue: () => boolean;
}

type SyncOperation = (context: SyncExecutionContext) => Promise<void>;
const MIN_SYNC_TIMEOUT_MS = 1000;

function unauthorizedResponse(message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function authenticateCronSecret(c: Context): Response | null {
  const authHeader = c.req.header("authorization");

  if (!authHeader) {
    return unauthorizedResponse("Authorization header not provided");
  }

  const cronSecret = getEnv().CRON_SECRET;

  if (!cronSecret) {
    return unauthorizedResponse("Cron secret not set");
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return unauthorizedResponse("Invalid cron secret");
  }

  return null;
}

type LockReleaseResult = "released" | "ownership-changed" | "error";

async function releaseOwnedLock(
  lock: AcquiredSyncLock,
): Promise<LockReleaseResult> {
  try {
    const isReleased = await syncLockService.releaseLock(
      lock.key,
      lock.ownerToken,
    );
    return isReleased ? "released" : "ownership-changed";
  } catch (error) {
    console.error("Failed to unlock lock:", error);
    return "error";
  }
}

/**
 * Hard ceiling on a single sync run, kept below the `maxDuration` these routes
 * run under (300s — see apps/core/vercel.json) with room for the handler's
 * `finally` to release the lock. Without it a LOCK_TIMEOUT larger than
 * maxDuration lets a long run — e.g. the full registry replay — be killed by
 * the platform before the lock is released, so the next cron tick 409s and the
 * effective cadence halves.
 *
 * Sized to leave the registry replay as much of the platform budget as
 * possible: a lower ceiling does not make the replay safer, it just spreads
 * ~2.4k entries over proportionally more cron cycles.
 */
const MAX_SYNC_TIMEOUT_MS = 280_000;

function getSyncTimeoutMs(): number {
  const env = getEnv();
  const timeoutMs = env.LOCK_TIMEOUT - env.LOCK_TIMEOUT_BUFFER;
  return Math.min(
    Math.max(timeoutMs, MIN_SYNC_TIMEOUT_MS),
    MAX_SYNC_TIMEOUT_MS,
  );
}

/**
 * Returns a promise that runs the sync operation and releases
 * the lock when done. Pass this to Vercel's waitUntil() so the serverless
 * runtime keeps the invocation alive until the sync completes.
 */
function runBackgroundSync(
  lock: AcquiredSyncLock,
  syncOperation: SyncOperation,
): Promise<void> {
  return (async () => {
    const timeoutMs = getSyncTimeoutMs();
    const deadlineMs = Date.now() + timeoutMs;
    const cancellationController = new AbortController();
    const cancellationTimeout = setTimeout(() => {
      console.warn(
        `[sync/${lock.key}] Deadline reached after ${timeoutMs}ms; requesting cancellation`,
      );
      cancellationController.abort();
    }, timeoutMs);

    const context: SyncExecutionContext = {
      abortSignal: cancellationController.signal,
      deadlineMs,
      msRemaining: () => {
        return Math.max(0, deadlineMs - Date.now());
      },
      shouldContinue: () => {
        return (
          !cancellationController.signal.aborted && Date.now() < deadlineMs
        );
      },
    };

    const startedAt = Date.now();
    try {
      await syncOperation(context);

      if (!context.shouldContinue()) {
        console.info(
          `[sync/${lock.key}] Sync operation settled after cancellation request (durationMs=${Date.now() - startedAt})`,
        );
      } else {
        console.info(
          `[sync/${lock.key}] Sync operation settled normally (durationMs=${Date.now() - startedAt})`,
        );
      }
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      clearTimeout(cancellationTimeout);
      const releaseResult = await releaseOwnedLock(lock);
      if (releaseResult === "released") {
        console.info(`[sync/${lock.key}] Lock released`);
      } else if (releaseResult === "ownership-changed") {
        console.warn(
          `[sync/${lock.key}] Lock not released because ownership changed`,
        );
      } else {
        console.warn(`[sync/${lock.key}] Lock release failed`);
      }
    }
  })();
}

export async function handleSyncRequest(
  c: Context,
  lockKey: string,
  syncOperation: SyncOperation,
): Promise<Response> {
  const unauthorized = authenticateCronSecret(c);
  if (unauthorized) {
    return unauthorized;
  }

  let acquiredLock: AcquiredSyncLock;
  try {
    acquiredLock = await syncLockService.acquireLock(lockKey);
  } catch (error) {
    if (error instanceof Error && error.message === "LOCK_IS_LOCKED") {
      return new Response(
        JSON.stringify({ message: "Syncing already in progress" }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    }

    return new Response(JSON.stringify({ message: "Failed to acquire lock" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  const backgroundPromise = runBackgroundSync(acquiredLock, syncOperation);
  waitUntil(backgroundPromise);

  return new Response(JSON.stringify({ message: "Syncing started" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
