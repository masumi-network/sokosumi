import * as Sentry from "@sentry/node";

import { paymentClient } from "@/clients/masumi-payment.client";
import {
  CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
  CARDANO_V2_RAIL_READINESS_KEY,
  getCardanoV2ReadySources,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

/**
 * The retry budget: what one attempt gets, how long the loop waits between
 * attempts, and the ceiling on the whole check.
 *
 * The three numbers only work as a set, so they travel as one and a caller
 * overrides all of them or none. That override is also the only way the
 * wiring below is testable at all: AbortSignal.timeout does not go through
 * the global setTimeout, so no fake timer can wind a 20s deadline forward,
 * and a real one would cost 20s of suite time.
 */
export interface ReadinessBudget {
  /** What a healthy payment node has to answer one attempt within. */
  attemptTimeoutMs: number;
  /**
   * Ceiling on the whole check, retries and backoff included. It must outlast
   * one attempt and fall short of two.
   *
   * Owned here rather than by the caller so the function is bounded on its
   * own: the attempt count alone allows four attempts, and a caller that
   * passes no signal would hang for 83.25s. The caller's signal still
   * composes with this one, so a cron deadline can still cut the check short.
   *
   * No node call can START after this fires: the loop checks before every
   * attempt and again after every wait. The backoff is NOT abortable though,
   * so a loop stopped mid-wait still finishes that wait, and the LOOP is
   * bounded at this number plus the last backoff step, 27s below. The
   * function is not bounded at all: the Prisma reads and writes that follow
   * the loop carry no deadline.
   */
  totalTimeoutMs: number;
  /** Wait after the attempt that just failed, holding at the last step. */
  backoffMs: readonly number[];
}

/**
 * The attempt timeout is what a healthy payment node has to answer within.
 * The retries are for a far side that fails FAST: a refused connection, a DNS
 * failure, a proxy 502. Those return in milliseconds, so WITHOUT the backoff
 * all four attempts land inside the same millisecond and survive no blip at
 * all. The wait is what makes a retry a retry.
 *
 * A repeated TIMEOUT is the opposite. It costs the full attempt timeout every
 * time, so the total ceiling ends the loop long before the count does. That
 * is deliberate. The registry sync shares this cron's budget and must not be
 * starved to keep retrying a node that is not answering. 25s is the number
 * that makes both failure shapes behave as documented: a fast-failing node
 * fits all four attempts and the 3.25s of backoff inside it, and a hanging
 * node gets two attempts and then stops.
 *
 * Deterministic failures are retried too, including a 401 or a 404 that cannot
 * succeed on a repeat. That is a deliberate difference from
 * registerJobPurchase, which sorts permanent from ambiguous first: that path
 * spends money, so a wrong repeat has a cost, while this one is a read whose
 * only status signal is a substring of an error message. Three wasted reads on
 * a misconfigured node is cheaper than parsing our own error text and cheaper
 * than the coupling that parse would create.
 */
/*
 * What the suite pins about these values, and what it cannot. `backs off for
 * real when the caller injects no sleep` runs this default end to end, so
 * backoffMs is bound to what ships. The two timeouts are NOT bound: observing
 * a 20s or a 25s deadline costs that much real time, so a default that drifted
 * away from this object would pass. Change the two together.
 */
export const READINESS_BUDGET: ReadinessBudget = {
  attemptTimeoutMs: 20_000,
  totalTimeoutMs: 25_000,
  backoffMs: [250, 1_000, 2_000],
};

const READINESS_MAX_ATTEMPTS = 4;

/**
 * Local rather than shared with job-purchase-registration's identical
 * three-liner: exporting a sleep across a helper/service boundary buys nothing
 * a `setTimeout` does not already give, and the two have different backoff
 * arrays and different retry policies, so the part worth sharing is the part
 * that differs.
 */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Each attempt needs its OWN deadline. Reusing one signal for every attempt
 * would hand attempt two a timeout that already fired, so every retry would
 * return instantly and the count would be spent without a single extra
 * request. The outer signal rides along, so the total ceiling and the caller's
 * deadline both still cut an attempt short.
 */
function withTimeout(outer: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return outer ? AbortSignal.any([outer, timeout]) : timeout;
}

export interface SyncCardanoV2RailReadinessOptions {
  signal?: AbortSignal;
  /** Injected by tests so the backoff does not cost real seconds. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected by tests so the deadlines above are observable at all. */
  budget?: ReadinessBudget;
}

/**
 * Marker states. The row exists for the length of one failure streak and a
 * successful check deletes it, so these are the streak's own states, not the
 * rail's. "failed" is what a fresh streak writes; the escalation flips it so
 * exactly one worker can report the streak outliving the threshold below.
 */
const READINESS_FAILURE_NEW = "failed";
const READINESS_FAILURE_ESCALATED = "escalated";

/**
 * How long a failure streak may run before it stops being a blip.
 *
 * The first tick of a streak alerts and the latch then goes quiet, so a
 * lasting outage does not page every five minutes. That silence is right for
 * minutes and wrong for hours. Readiness has no age expiry on purpose, so a
 * V2 catalogue that is already enabled STAYS enabled through the whole
 * outage: agents keep being listed and priced from the last recorded sources
 * while every purchase against them fails at the node. Six ticks is where
 * that stops looking like a blip.
 *
 * Deliberately not shorter. The point of this branch is to stop paging for a
 * single timed-out attempt, and a threshold inside one or two ticks would put
 * that page straight back.
 */
const READINESS_FAILURE_ESCALATION_MS = 30 * 60 * 1000;

/**
 * Refreshes the recorded Cardano V2 rail readiness of the payment node (read
 * by getCardanoV2ReadySources).
 *
 * On check failure the last known value is kept and a marker is written, so
 * readers keep serving it rather than losing the V2 catalog to an outage of
 * our own polling. That degradation is only graceful while the last known
 * value is a USABLE one. A recorded empty set hides the whole V2 catalogue as
 * completely as no recording at all, which is why the alert below takes its
 * SEVERITY from what readers are served. How OFTEN it may fire is a separate
 * question, and that one still turns on whether a row exists at all.
 *
 * Returns whether the purchase-ready source set CHANGED, which is what makes
 * the caller replay the registry — and, since a change from "nothing recorded"
 * to a ready source also lifts the ingestion rollback fence in
 * syncRegistryAgents, that replay is what first writes the V2 rows.
 */
export async function syncCardanoV2RailReadiness(
  options: SyncCardanoV2RailReadinessOptions = {},
): Promise<boolean> {
  const { attemptTimeoutMs, totalTimeoutMs, backoffMs } =
    options.budget ?? READINESS_BUDGET;
  const sleep = options.sleep ?? sleepMs;
  const deadline = withTimeout(options.signal, totalTimeoutMs);
  const node = paymentClient();
  let readinessResult = await node.getCardanoV2RailReadiness({
    signal: withTimeout(deadline, attemptTimeoutMs),
  });
  for (
    let attempt = 2;
    attempt <= READINESS_MAX_ATTEMPTS &&
    readinessResult.isErr() &&
    !deadline.aborted;
    attempt += 1
  ) {
    console.warn(
      `[sync/agents] Cardano V2 rail readiness attempt ${attempt - 1} failed; retrying:`,
      readinessResult.error,
    );
    await sleep(backoffMs[attempt - 2] ?? backoffMs.at(-1) ?? 0);
    // The wait is where a short budget usually runs out.
    if (deadline.aborted) {
      break;
    }
    readinessResult = await node.getCardanoV2RailReadiness({
      signal: withTimeout(deadline, attemptTimeoutMs),
    });
  }

  if (readinessResult.isErr()) {
    console.warn(
      "[sync/agents] Cardano V2 rail readiness check failed:",
      readinessResult.error,
    );
    try {
      // HOW BAD is it? Is a usable fallback actually being served? The two
      // cases degrade completely differently and must not share one alert.
      //
      // Ask the question readers ask. Row EXISTENCE answers a different
      // question and answers this one wrong: the success path upserts
      // whatever it got, so a tick where the node reported nothing ready
      // leaves a row holding "[]". That row hides the catalogue exactly as
      // completely as no row at all, and calling it "warm" would downgrade a
      // live outage to a warning and then latch it into silence.
      //
      // Hidden (no usable source): every V2 agent is unlistable and every V2
      // task payment 422s. That is an outage, and it is the state a fresh
      // environment, a deploy landing before the node serves /rail-readiness,
      // and a node reporting nothing purchase-ready all share.
      //
      // Stale (sources are being served): readers keep serving the last known
      // value, so a failed check costs nothing user-visible.
      const isCatalogueHidden =
        (await getCardanoV2ReadySources(prisma)).length === 0;

      // HOW OFTEN may it page is a separate question, and row existence is
      // the right answer to THIS one. A catalogue that was recorded and then
      // went empty already paged when it went empty, on the success path
      // below. Bypassing the latch for it as well would page every five
      // minutes for the length of an outage, which is the noise this change
      // exists to cut, not add to.
      const recordedReadiness = await prisma.syncMetadata.findUnique({
        where: { key: CARDANO_V2_RAIL_READINESS_KEY },
        select: { key: true },
      });
      const hasNeverBeenRecorded = !recordedReadiness;

      // createMany + skipDuplicates is an atomic cross-instance latch:
      // exactly one serverless worker creates the marker and reports the
      // failure; later workers see count=0 until a successful check clears it.
      const marker = await prisma.syncMetadata.createMany({
        data: [
          {
            key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
            cursorId: READINESS_FAILURE_NEW,
            lastSyncedAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      // HOW LONG has it been failing is the third question, and the marker
      // row already answers it: skipDuplicates never touches an existing row,
      // so lastSyncedAt still holds the moment the streak started.
      //
      // The latch's silence is right for a blip and wrong for an outage.
      // Nothing expires the recorded readiness, so an enabled V2 catalogue
      // stays enabled for the whole outage and keeps selling agents that
      // cannot be paid for. A streak that outlives the threshold earns one
      // more alert, and that one is an error whatever the catalogue looks
      // like, because purchases have been failing for half an hour.
      //
      // Same atomic latch trick as the insert above: exactly one worker wins
      // the conditional update and reports; the rest see count=0. The state
      // lives in the row, so the escalation fires once per streak rather than
      // once per tick, and a successful check deletes the row and re-arms it.
      const escalation =
        marker.count > 0
          ? { count: 0 }
          : await prisma.syncMetadata.updateMany({
              where: {
                key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
                cursorId: READINESS_FAILURE_NEW,
                lastSyncedAt: {
                  lt: new Date(Date.now() - READINESS_FAILURE_ESCALATION_MS),
                },
              },
              data: { cursorId: READINESS_FAILURE_ESCALATED },
            });
      const isStreakSustained = escalation.count > 0;

      // The latch is deliberately bypassed while readiness has never been
      // recorded: silence would otherwise be indistinguishable from a healthy
      // deployment that simply has no V2 agents, and the single page that the
      // latch does allow is spent on the first tick — minutes after deploy,
      // long before anyone looks.
      if (marker.count > 0 || hasNeverBeenRecorded || isStreakSustained) {
        Sentry.captureException(
          new Error(
            isCatalogueHidden
              ? `Cardano V2 rail readiness has no usable value; the entire V2 catalogue is hidden. Last error: ${readinessResult.error}`
              : isStreakSustained
                ? `Cardano V2 rail readiness has failed for over ${READINESS_FAILURE_ESCALATION_MS / 60_000}m; V2 agents are still listed from the last recorded sources, so purchases against them keep failing. Last error: ${readinessResult.error}`
                : `Cardano V2 rail readiness check failed: ${readinessResult.error}`,
          ),
          {
            // Severity follows the user-visible impact, not the check result.
            // Hidden IS the outage: no V2 agent can be listed or paid right
            // now. Stale is not. Readers keep serving the last recorded
            // sources, the next cron tick is five minutes out, and the usual
            // cause is one timed-out attempt that costs nothing anybody can
            // see. Paging for that teaches people to skip the alert, which is
            // how the hidden case gets missed too. A stale streak that has
            // outlived the threshold is no longer that case: it is an outage
            // that has been running for half an hour, so it takes the error
            // level back.
            level: isCatalogueHidden || isStreakSustained ? "error" : "warning",
            tags: {
              cardano_v2_readiness: isCatalogueHidden
                ? "hidden"
                : isStreakSustained
                  ? "stale_sustained"
                  : "stale",
            },
          },
        );
      }
    } catch (markerError) {
      // Readiness is advisory and must never crash the registry sync loop.
      console.warn(
        "[sync/agents] Failed to persist Cardano V2 readiness failure marker:",
        markerError,
      );
    }
    return false;
  }

  const readySources = [...readinessResult.value].sort((left, right) => {
    const policyComparison = left.policyId.localeCompare(right.policyId);
    return policyComparison !== 0
      ? policyComparison
      : left.smartContractAddress.localeCompare(right.smartContractAddress);
  });
  const serializedReadySources = JSON.stringify(readySources);
  let readinessChanged: boolean;
  try {
    const previousReadiness = await prisma.syncMetadata.findUnique({
      where: { key: CARDANO_V2_RAIL_READINESS_KEY },
    });
    // A changed source set reprojects every V2 price, because pricing is
    // projected from the purchase-ready source. Age alone is not a change:
    // readers now always serve the last recorded value, so no window exists in
    // which they saw [] and projected against the fallback instead.
    // `undefined !== string` also covers the first run, when no row exists.
    readinessChanged = previousReadiness?.cursorId !== serializedReadySources;
    await prisma.syncMetadata.upsert({
      where: { key: CARDANO_V2_RAIL_READINESS_KEY },
      create: {
        key: CARDANO_V2_RAIL_READINESS_KEY,
        cursorId: serializedReadySources,
        lastSyncedAt: new Date(),
      },
      update: {
        cursorId: serializedReadySources,
        lastSyncedAt: new Date(),
      },
    });
  } catch (cacheError) {
    // Readiness is advisory and must never crash the registry sync loop. A
    // failed write leaves the old cache intact, so retry on the next cycle.
    console.warn(
      "[sync/agents] Failed to persist Cardano V2 rail readiness:",
      cacheError,
    );
    return false;
  }

  try {
    await prisma.syncMetadata.deleteMany({
      where: { key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY },
    });
  } catch (cleanupError) {
    // Cache persistence already succeeded. Keep readinessChanged so source
    // changes still trigger a registry replay; retry marker cleanup next time.
    console.warn(
      "[sync/agents] Failed to clear Cardano V2 readiness failure marker:",
      cleanupError,
    );
  }

  if (readySources.length === 0) {
    console.warn(
      "[sync/agents] No Cardano V2 source is purchase-ready; V2 agents stay unavailable",
    );
    // A successful check reporting ZERO ready sources hides the entire V2
    // catalog just as effectively as a failed check, so it must page too —
    // only report on the transition, so a lasting outage does not spam.
    if (readinessChanged) {
      Sentry.captureMessage(
        "Cardano V2 rail reports no purchase-ready source; all V2 agents are hidden",
        "error",
      );
    }
  }
  return readinessChanged;
}
