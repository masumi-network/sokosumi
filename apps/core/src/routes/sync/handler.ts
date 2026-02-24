import { getEnv } from "@/config/env";
import { syncLockService } from "@/services/sync-lock.service";

function unauthorizedResponse(message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function authenticateCronSecret(
  authHeader: string | null | undefined,
): Response | null {
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
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("SYNC_TIMEOUT"));
    }, milliseconds);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function startBackgroundSync(
  lockKey: string,
  syncOperation: () => Promise<void>,
) {
  void (async () => {
    try {
      const timeoutMs = Math.max(
        1,
        getEnv().LOCK_TIMEOUT - getEnv().LOCK_TIMEOUT_BUFFER,
      );
      await withTimeout(syncOperation(), timeoutMs);
    } catch (error) {
      console.error("Error in sync operation:", error);
    } finally {
      try {
        await syncLockService.releaseLock(lockKey);
      } catch (error) {
        console.error("Failed to unlock lock:", error);
      }
    }
  })();
}

export async function handleSyncRequest(
  authHeader: string | null | undefined,
  lockKey: string,
  syncOperation: () => Promise<void>,
): Promise<Response> {
  const unauthorized = authenticateCronSecret(authHeader);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    await syncLockService.acquireLock(lockKey);
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

  startBackgroundSync(lockKey, syncOperation);

  return new Response(JSON.stringify({ message: "Syncing started" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
