import { waitUntil } from "@vercel/functions";
import type { Context } from "hono";

import { getEnv } from "@/config/env";
import type { AcquiredSyncLock } from "@/services/sync-lock.service";
import { syncLockService } from "@/services/sync-lock.service";

type SyncOperation = () => Promise<void>;
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

async function releaseOwnedLock(lock: AcquiredSyncLock): Promise<void> {
  try {
    const isReleased = await syncLockService.releaseLock(
      lock.key,
      lock.ownerToken,
    );
    if (!isReleased) {
      console.error(
        `Lock release skipped because ownership changed for lock key "${lock.key}"`,
      );
    }
  } catch (error) {
    console.error("Failed to unlock lock:", error);
  }
}

function getSyncTimeoutMs(): number {
  const env = getEnv();
  const timeoutMs = env.LOCK_TIMEOUT - env.LOCK_TIMEOUT_BUFFER;
  return Math.max(timeoutMs, MIN_SYNC_TIMEOUT_MS);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
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
    try {
      const timeoutMs = getSyncTimeoutMs();
      await withTimeout(
        syncOperation(),
        timeoutMs,
        `[sync/${lock.key}] Timed out after ${timeoutMs}ms before lock expiration`,
      );
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      await releaseOwnedLock(lock);
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
