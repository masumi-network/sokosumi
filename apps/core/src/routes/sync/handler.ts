import { waitUntil } from "@vercel/functions";
import type { Context } from "hono";

import { getEnv } from "@/config/env";
import type { AcquiredSyncLock } from "@/services/sync-lock.service";
import { syncLockService } from "@/services/sync-lock.service";

export interface SyncOperationContext {
  shouldContinue: () => boolean;
}

type SyncOperation = (context: SyncOperationContext) => Promise<void>;

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

/**
 * Returns a promise that runs the sync operation with heartbeat and releases
 * the lock when done. Pass this to Vercel's waitUntil() so the serverless
 * runtime keeps the invocation alive until the sync completes.
 */
function runBackgroundSync(
  lock: AcquiredSyncLock,
  syncOperation: SyncOperation,
): Promise<void> {
  let shouldContinue = true;
  let heartbeatInFlight = false;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  function stopSync(message: string, error?: unknown): void {
    if (!shouldContinue) {
      return;
    }

    shouldContinue = false;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (error) {
      console.error(message, error);
      return;
    }

    console.error(message);
  }

  const heartbeatIntervalMs = Math.max(
    1000,
    Math.floor(getEnv().LOCK_TIMEOUT / 2),
  );
  heartbeatInterval = setInterval(() => {
    if (heartbeatInFlight || !shouldContinue) {
      return;
    }

    heartbeatInFlight = true;
    void (async () => {
      try {
        const heartbeatRefreshed = await syncLockService.heartbeatLock(
          lock.key,
          lock.ownerToken,
        );
        if (!heartbeatRefreshed) {
          stopSync(
            `Stopping sync because lock ownership changed for lock key "${lock.key}"`,
          );
        }
      } catch (error) {
        stopSync("Stopping sync because lock heartbeat failed:", error);
      } finally {
        heartbeatInFlight = false;
      }
    })();
  }, heartbeatIntervalMs);

  return (async () => {
    try {
      await syncOperation({
        shouldContinue: () => shouldContinue,
      });
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
      }
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
