import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import type { RequestLogger } from "evlog";
import { createError } from "evlog";
import type { Context } from "hono";

import { getEnv } from "@/config/env";
import type { NetworkScope } from "@/lib/db/network-scope";
import {
  createCoreLogger,
  emitCoreError,
  emitCoreWarning,
  logCoreWarning,
  runAsBackgroundWork,
  tryUseLogger,
} from "@/lib/evlog";
import { isPreprodOn, type Network, networkKey } from "@/lib/network";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { DetachedNetworkRefusal } from "@/lib/soko-bot/detached-network-refusal";
import type { networkSyncLease } from "@/services/network-sync-lease";
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

/**
 * What the operation of a cron that declared its Network gets: also that
 * Network's scope. The work may keep the scope after the response; it opens a
 * transaction itself when it needs one, and the transaction ends with it.
 */
export interface NetworkSyncRunContext extends SyncRunContext {
  scope: NetworkScope;
  lease: ReturnType<typeof networkSyncLease>;
}

type SyncOperation<Context = SyncRunContext> = (
  context: Context,
) => Promise<void>;

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
   * idle monitor. Failed runs stay on the run monitor. Network crons use
   * only the run monitor.
   */
  idleRunsAlert?: number;
  /** A feature flag: while it is off, an authenticated tick returns before the lock, so it writes nothing. */
  enabled?: () => boolean;
  /** Never here: a variable or a spread that carries a Network is not these options. */
  network?: never;
}

/** The Network a cron works on, declared where it is registered. */
export interface NetworkSyncRequestOptions
  extends Omit<SyncRequestOptions, "network" | "idleRunsAlert"> {
  network: Network;
  idleRunsAlert?: never;
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
  syncOperation: (context: SyncRunContext) => Promise<void | "skipped">,
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
    let skipped = false;
    try {
      skipped = (await syncOperation(context)) === "skipped";
      log.set({
        sync: {
          outcome: skipped
            ? "skipped"
            : context.shouldContinue()
              ? "completed"
              : "cancelled",
        },
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
          idle: !skipped && !failed && idle,
          idleRunsAlert,
        });
      await flushCronMonitor();
    }
  })();
}

/**
 * A cron that works on a Network declares it as `network`; its operation gets
 * that Network's scope as `context.scope`. Without the option the handler
 * hands it no scope.
 */
export async function handleSyncRequest(
  c: Context,
  lockKey: string,
  syncOperation: SyncOperation<NetworkSyncRunContext>,
  options: NetworkSyncRequestOptions,
): Promise<Response>;
export async function handleSyncRequest(
  c: Context,
  lockKey: string,
  syncOperation: SyncOperation,
  options?: SyncRequestOptions,
): Promise<Response>;
export async function handleSyncRequest(
  c: Context,
  lockKey: string,
  syncOperation: SyncOperation | SyncOperation<NetworkSyncRunContext>,
  {
    errorDetail = "safe-fields",
    idleRunsAlert,
    network,
    enabled,
  }: SyncRequestOptions | NetworkSyncRequestOptions = {},
): Promise<Response> {
  const unauthorized = authenticateCronSecret(c);
  if (unauthorized) {
    return unauthorized;
  }
  const preprod = network === "preprod";
  const skip = (reason: string) => {
    const key = networkKey("preprod", lockKey);
    tryUseLogger()?.set({ sync: { lockKey: key, outcome: "skipped", reason } });
    cronStillRunning(c.req.path, key);
    waitUntil(flushCronMonitor());
    return Response.json({ message: "Sync skipped", reason });
  };
  if (preprod && !isPreprodOn()) return skip("off");
  if (enabled && !enabled()) {
    if (preprod) return skip("unconfigured");
    return new Response(JSON.stringify({ message: "Sync disabled" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Before the lock: a Network that is off throws here and holds nothing.
  // Imported here, so a cron without a Network does not load the clients'
  // module through this handler.
  let run: (context: SyncRunContext) => Promise<void | "skipped">;
  let resolvedKey = lockKey;
  if (network === undefined) {
    // Known safe: `network?: never` on the plain options leaves only the
    // plain overload without a Network, and its operation asks for no scope.
    run = syncOperation as SyncOperation;
  } else {
    const { createNetworkScope } = await import("@/lib/db/network-scope");
    const preprodControl = preprod
      ? await import("@/helpers/preprod-control")
      : undefined;
    const { networkSyncLease, SyncLeaseLost } = await import(
      "@/services/network-sync-lease"
    );
    const admission = await preprodControl?.readPreprodControl();
    if (admission && admission.state !== "open") return skip(admission.state);
    const scope = createNetworkScope(network);
    resolvedKey = networkKey(scope.network, lockKey);
    run = async (context) => {
      if (preprodControl && admission) {
        const current = await preprodControl.readPreprodControl();
        if (
          current.state !== "open" ||
          current.generation !== admission.generation
        )
          return "skipped";
      }
      const lease = networkSyncLease(
        scope,
        acquiredLock,
        admission?.generation ?? null,
      );
      try {
        await syncOperation({ ...context, scope, lease });
      } catch (error) {
        if (
          error instanceof SyncLeaseLost ||
          (preprod && error instanceof DetachedNetworkRefusal)
        )
          return "skipped";
        throw error;
      }
    };
  }

  let acquiredLock: AcquiredSyncLock;
  try {
    acquiredLock = await syncLockService.acquireLock(resolvedKey);
  } catch (error) {
    if (error instanceof Error && error.message === "LOCK_IS_LOCKED") {
      cronStillRunning(c.req.path, resolvedKey, idleRunsAlert);
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
      runBackgroundSync(acquiredLock, run, {
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
