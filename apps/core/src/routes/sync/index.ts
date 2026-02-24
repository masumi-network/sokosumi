import { Hono } from "hono";

import { getEnv } from "@/config/env";
import {
  AGENTS_SUMMARY_SYNC_LOCK_KEY,
  AGENTS_SYNC_LOCK_KEY,
  agentSyncService,
} from "@/services/agent-sync.service";
import { syncLockService } from "@/services/sync-lock.service";

const app = new Hono();

function authenticateCronSecret(authHeader: string | null): Response | null {
  const cronSecret = getEnv().CRON_SECRET;
  if (!cronSecret) {
    return new Response(JSON.stringify({ message: "Cron secret not set" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ message: "Invalid cron secret" }), {
      status: 401,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return null;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
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

function startBackgroundSync(lockKey: string, syncOperation: () => Promise<void>) {
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

async function handleSyncRequest(
  authHeader: string | null,
  lockKey: string,
  syncOperation: () => Promise<void>,
) {
  const unauthorizedResponse = authenticateCronSecret(authHeader);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
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

app.get("/agents", async (c) => {
  return await handleSyncRequest(
    c.req.header("authorization") ?? null,
    AGENTS_SYNC_LOCK_KEY,
    async () => {
      await agentSyncService.syncRegistryAgents();
    },
  );
});

app.get("/agents-summary", async (c) => {
  return await handleSyncRequest(
    c.req.header("authorization") ?? null,
    AGENTS_SUMMARY_SYNC_LOCK_KEY,
    async () => {
      await agentSyncService.syncAgentSummaries();
    },
  );
});

export default app;
