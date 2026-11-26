import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import type { RequestLogger } from "evlog";
import { createError } from "evlog";
import type { Context } from "hono";

import { getEnv } from "@/config/env";
import {
  createCoreLogger,
  emitCoreError,
  emitCoreWarning,
  logCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import type { AcquiredSyncLock } from "@/services/sync-lock.service";
import { syncLockService } from "@/services/sync-lock.service";
import {
  cronStillRunning,
  flushCronMonitor,
  reportCronIdleness,
  startCronMonitor,
} from "./monitor.js";

export interface SyncExecutionContext {
  abortSignal: AbortSignal;
  deadlineMs: number;
  msRemaining: () => number;
  shouldContinue: () => boolean;
}

/** What a cron route's operation gets: the execution context and its run's event. */
export interface SyncRunContext extends SyncExecutionContext {
  /**
   * The run's own standalone event, emitted when the run ends: a sync puts
   * its counts there with `log.set({ result })` and a warning it survives
   * with `logCoreWarning`. A failure it survives is its own error event.
   */
  log: Pick<RequestLogger, "set" | "warn" | "getContext">;
  /**
   * The items this run took on: those it `done` and those that `failed`.
   * A run whose every item failed is a failed run of its cron monitor; a
   * run with neither is idle, which only `idleRunsAlert` watches.
   */
  reportWork: (work: { done: number; failed?: number }) => void;
}

type SyncOperation = (context: SyncRunContext) => Promise<void>;

/**
 * What the run's event keeps of an error its sync throws. `cause` (redacted)
 * only for a sync whose every call carries ids, counts, dates and enum
 * values: a Prisma validation error quotes its call's arguments, so a write
 * of external text (registry, catalog, customer) leaks through the cause.
 * Every other sync keeps the safe fields only.
 */
export interface SyncRequestOptions {
  errorDetail?: "cause" | "safe-fields";
  /**
   * For a sync that always has work in production: this many runs in a row
   * that report no work (`reportWork`) open a Sentry issue on the cron's
   * idle monitor. Failed runs stay on the run monitor.
   */
  idleRunsAlert?: number;
}
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

/** Names every cron run's events. */
const CRON_SYNC_OPERATION = "cron_sync";

type LockReleaseResult = "released" | "ownership_changed" | "release_failed";

async function releaseOwnedLock(
  lock: AcquiredSyncLock,
): Promise<LockReleaseResult> {
  try {
    const isReleased = await syncLockService.releaseLock(
      lock.key,
      lock.ownerToken,
    );
    return isReleased ? "released" : "ownership_changed";
  } catch (error) {
    // Its own event: the run event can hold one error, the sync's.
    emitCoreError(
      { operation: CRON_SYNC_OPERATION, sync: { lockKey: lock.key } },
      {
        message: "Could not release a scheduled sync's lock",
        why: "The database update that frees the lock failed",
        fix: "Nothing to do now: the lock expires after LOCK_TIMEOUT and the next run takes it. If it fails every run, check the database.",
        cause: error,
      },
    );
    return "release_failed";
  }
}

function getSyncTimeoutMs(): number {
  const env = getEnv();
  const timeoutMs = env.LOCK_TIMEOUT - env.LOCK_TIMEOUT_BUFFER;
  return Math.max(timeoutMs, MIN_SYNC_TIMEOUT_MS);
}

/**
 * Returns a promise that runs the sync operation and releases
 * the lock when done. Pass this to Vercel's waitUntil() so the serverless
 * runtime keeps the invocation alive until the sync completes.
 */
function runBackgroundSync(
  lock: AcquiredSyncLock,
  syncOperation: SyncOperation,
  {
    path,
    errorDetail,
    idleRunsAlert,
  }: {
    path: string;
    errorDetail: NonNullable<SyncRequestOptions["errorDetail"]>;
    idleRunsAlert?: number;
  },
): Promise<void> {
  return (async () => {
    const timeoutMs = getSyncTimeoutMs();
    const deadlineMs = Date.now() + timeoutMs;
    const monitor = startCronMonitor({
      path,
      lockKey: lock.key,
      maxRuntimeMs: timeoutMs,
    });
    const work = { done: 0, failed: 0 };
    const cancellationController = new AbortController();
    // One standalone event per run: its outcome, the lock, and the sync's
    // own counts (`context.log`). The request's event is already emitted.
    const log = createCoreLogger({
      operation: CRON_SYNC_OPERATION,
      sync: { lockKey: lock.key },
    });
    // Bound so the warning keeps the run's `syncRunId` on any timer
    // implementation, fake timers in tests included.
    const cancellationTimeout = setTimeout(
      AsyncLocalStorage.bind(() => {
        // Its own event, sent now: a sync that ignores the cancellation never
        // settles, and the run event would never be sent.
        emitCoreWarning(
          {
            operation: CRON_SYNC_OPERATION,
            sync: { lockKey: lock.key, timeoutMs },
          },
          {
            message:
              "A scheduled sync reached its deadline and was asked to stop",
            why: "It ran longer than its time budget, LOCK_TIMEOUT minus LOCK_TIMEOUT_BUFFER",
            fix: "Nothing to do when it happens now and then: the sync stops at a safe point and the next run continues. If it happens every run, its run events show where the time goes.",
          },
        );
        cancellationController.abort();
      }),
      timeoutMs,
    );

    const context: SyncRunContext = {
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
      log,
      reportWork: ({ done, failed = 0 }) => {
        work.done += done;
        work.failed += failed;
      },
    };

    const startedAt = Date.now();
    let failed = false;
    try {
      await syncOperation(context);
      log.set({
        sync: { outcome: context.shouldContinue() ? "completed" : "cancelled" },
      });
    } catch (error) {
      failed = true;
      log.set({ sync: { outcome: "failed" } });
      // The route says whether its errors can carry user content.
      const keepsCause = errorDetail === "cause";
      log.error(
        createError({
          message: "A scheduled sync failed",
          why: "The sync threw before it finished",
          fix: keepsCause
            ? "The next run starts it again. The cause on this event says why it threw."
            : "The next run starts it again. This sync's errors can quote user content, so the event keeps only failure (name, known code, status); run the sync locally for the full error.",
          ...(keepsCause &&
          (error instanceof Error || typeof error === "string")
            ? { cause: error instanceof Error ? error : new Error(error) }
            : {}),
        }),
        { failure: messageSafeErrorFields(error) },
      );
    } finally {
      clearTimeout(cancellationTimeout);
      const releaseResult = await releaseOwnedLock(lock);
      log.set({
        sync: { durationMs: Date.now() - startedAt, lock: releaseResult },
      });
      if (releaseResult === "ownership_changed") {
        logCoreWarning(log, {
          message: "A scheduled sync's lock was not released",
          why: "Another run owns the lock now: it expired while this run was still going",
          fix: "If it repeats, the sync runs past LOCK_TIMEOUT and two runs overlap; its run events show where the time goes.",
        });
      }
      // Every item it took on failed: a failed run, never an idle one.
      const workFailed = work.failed > 0 && work.done === 0;
      const idle = work.done === 0 && work.failed === 0;
      log.set({ sync: { work, ...(workFailed ? { workFailed } : {}) } });
      log.emit();
      monitor?.finish(failed || workFailed ? "error" : "ok");
      // Only an observed run counts toward idleness: one that threw says
      // nothing about whether there was work, yet still checks in.
      if (idleRunsAlert !== undefined)
        reportCronIdleness({
          path,
          lockKey: lock.key,
          idle: !failed && idle,
          idleRunsAlert,
        });
      await flushCronMonitor();
    }
  })();
}

export async function handleSyncRequest(
  c: Context,
  lockKey: string,
  syncOperation: SyncOperation,
  { errorDetail = "safe-fields", idleRunsAlert }: SyncRequestOptions = {},
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
      cronStillRunning(c.req.path, lockKey, idleRunsAlert);
      // Sent before the function may freeze, as a run's check-ins are.
      waitUntil(flushCronMonitor());
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

  // Known background work: its events stay standalone even while this
  // request's event is still live (`recordCoreError` in shared code). Every
  // event the run sends, its services' included, carries `syncRunId`, which
  // ties them to this run when runs overlap.
  const backgroundPromise = runAsBackgroundWork(
    () =>
      runBackgroundSync(acquiredLock, syncOperation, {
        path: c.req.path,
        errorDetail,
        ...(idleRunsAlert ? { idleRunsAlert } : {}),
      }),
    { syncRunId: randomUUID() },
  );
  waitUntil(backgroundPromise);

  return new Response(JSON.stringify({ message: "Syncing started" }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
