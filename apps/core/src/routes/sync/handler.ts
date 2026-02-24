import { waitUntil } from "@vercel/functions";
import type { Context } from "hono";

import { getEnv } from "@/config/env";
import type { AcquiredSyncLock } from "@/services/sync-lock.service";
import { syncLockService } from "@/services/sync-lock.service";

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

async function withTimeout<T>(
  operation: () => Promise<T>,
  milliseconds: number,
): Promise<{ status: "completed" } | { status: "timed-out" }> {
  const operationPromise = operation();

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timed-out">((resolve) => {
    timeoutId = setTimeout(() => {
      resolve("timed-out");
    }, milliseconds);
  });

  let result:
    | "timed-out"
    | {
        status: "completed";
      };
  try {
    result = await Promise.race([
      operationPromise.then(
        () =>
          ({
            status: "completed",
          }) as const,
      ),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }

  if (result === "timed-out") {
    // Ensure we don't leak unhandled rejections after timeout detaches the operation.
    void operationPromise.catch((error) => {
      console.error("Sync operation failed after timeout:", error);
    });
    return {
      status: "timed-out",
    };
  }

  return result;
}

/**
 * Returns a promise that runs the sync operation with heartbeat and releases
 * the lock when done. Pass this to Vercel's waitUntil() so the serverless
 * runtime keeps the invocation alive until the sync completes.
 */
function runBackgroundSync(
  lock: AcquiredSyncLock,
  syncOperation: () => Promise<void>,
): Promise<void> {
  const heartbeatIntervalMs = Math.max(
    1000,
    Math.min(
      Math.floor(getEnv().LOCK_TIMEOUT / 2),
      getEnv().LOCK_TIMEOUT - getEnv().LOCK_TIMEOUT_BUFFER,
    ),
  );
  const heartbeatInterval = setInterval(() => {
    void (async () => {
      try {
        const heartbeatRefreshed = await syncLockService.heartbeatLock(
          lock.key,
          lock.ownerToken,
        );
        if (!heartbeatRefreshed) {
          console.error(
            `Lock ownership lost during heartbeat for lock key "${lock.key}"`,
          );
          clearInterval(heartbeatInterval);
        }
      } catch (error) {
        console.error("Failed to heartbeat lock:", error);
      }
    })();
  }, heartbeatIntervalMs);

  return (async () => {
    try {
      const timeoutMs = Math.max(
        1,
        getEnv().LOCK_TIMEOUT - getEnv().LOCK_TIMEOUT_BUFFER,
      );
      const timeoutResult = await withTimeout(syncOperation, timeoutMs);
      if (timeoutResult.status === "timed-out") {
        console.error(
          `Sync operation exceeded timeout (${timeoutMs}ms); releasing lock and allowing retry`,
        );
      }
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      clearInterval(heartbeatInterval);
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
  })();
}

export async function handleSyncRequest(
  c: Context,
  lockKey: string,
  syncOperation: () => Promise<void>,
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
