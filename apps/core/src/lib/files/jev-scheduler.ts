/**
 * Quotas and a circuit breaker in front of Jev.
 *
 * ## What is enforced where, exactly
 *
 * This module counts **in memory, per runtime**. On a platform that runs
 * many instances that is not a ceiling: ten instances meant ten times every
 * per-minute number here, under a name that read as global.
 *
 * So the per-minute ceilings gained a shared enforcement point.
 * `admitJevRequest` enforces `GLOBAL_REQUESTS_PER_MINUTE`,
 * `GLOBAL_INPUT_TOKENS_PER_MINUTE` and
 * `PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE` by counting admission **rows**
 * under one advisory lock, so every runtime sees one total.
 *
 * **"Moved" overstated it, and an earlier version of this docstring said so
 * wrongly.** Only `GLOBAL_REQUESTS_PER_MINUTE` has no in-memory counterpart
 * left. `tryAdmit` below still enforces *both* token ceilings itself, in
 * per-runtime windows (`takeFromTokenWindow`), so each of those two is
 * checked twice: once here as a per-process share, and once in the
 * admission as the real global total. The local copy is a pre-filter that
 * can only refuse earlier than the shared one, never later — which is safe,
 * but it does mean a single runtime can deny work the global ceiling would
 * still have allowed, and that a denial reason from this module says
 * nothing about global spend.
 *
 * What is only ever per-runtime, and why:
 *
 * - **Concurrency** (`GLOBAL_MAX_CONCURRENT`, `PER_QUERY_MAX_CONCURRENT`).
 *   "In flight" is a process-local fact. Making it shared needs a lease
 *   with a heartbeat and a reaper, because a runtime that dies mid-request
 *   would otherwise hold its slot forever. That is a bigger change than a
 *   counter and it is not in this branch.
 * - **The circuit breaker.** A breaker is a local reaction to what this
 *   runtime is seeing. Sharing it would mean one instance's bad minute
 *   silencing every other instance.
 * - **Per-second smoothing** (`GLOBAL_REQUESTS_PER_SECOND`,
 *   `PER_WORKSPACE_REQUESTS_PER_SECOND`, the burst capacities). These shape
 *   traffic within a runtime; the per-minute shared ceiling is what bounds
 *   the bill.
 *
 * Read the per-second and concurrency numbers as **per-runtime shares**,
 * because that is what they are. The per-minute numbers hold globally at
 * the admission, and additionally as per-runtime shares here for the two
 * token ceilings.
 *
 * Two things matter more than the exact numbers. Interactive search keeps a
 * reserved share that background labelling can never borrow, and a reserved
 * cost is counted at dispatch and never refunded on cancellation — a request
 * that left the process was paid for whether or not anyone waited for it.
 */

export const GLOBAL_REQUESTS_PER_MINUTE = 3_600;
export const GLOBAL_REQUESTS_PER_SECOND = 60;
export const GLOBAL_BURST_CAPACITY = 12;
export const GLOBAL_MAX_CONCURRENT = 24;
export const PER_QUERY_MAX_CONCURRENT = 6;
export const PER_WORKSPACE_REQUESTS_PER_SECOND = 30;
export const PER_WORKSPACE_BURST = 6;
/** Interactive search and related keep 80 % of the per-second budget. */
export const INTERACTIVE_RESERVED_FRACTION = 0.8;
export const GLOBAL_INPUT_TOKENS_PER_MINUTE = 6_000_000;
export const PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE = 1_500_000;

/**
 * Daily budgets. The per-minute ceilings above bound a *burst*; until these
 * existed nothing bounded a **day**.
 *
 * `PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE` sustained for 24 hours is
 * 2,160,000,000 input tokens for one workspace. A heavy real day — 100
 * reranked searches, 20 related passes and 300 documents labelled — is
 * 4,956,000. The minute ceiling was therefore 436× a heavy day, which is not
 * a spend control, it is a rate limiter wearing one's name.
 *
 * Two budgets, deliberately, because each covers the other's blind spot:
 *
 * - **Tokens** are counted by us, from our own request, so this can never
 *   silently stop working. It is the load-bearing one.
 * - **Spend** is read from the provider's own `providerMetadata.gateway.cost`
 *   and needs no price assumption, so it still holds if the price changes
 *   under us. But it is only as present as that field: if the Gateway ever
 *   stops returning a cost, every row records `null`, the sum stays zero and
 *   a spend-only cap would fail **open**. That is why it is not alone.
 *
 * The token figure is ~12× a heavy day and 1/36th of what the minute ceiling
 * allowed. The dollar figure is a first guess and **has to be reviewed
 * against the first real invoice** — no live call has ever been made from
 * this branch, so there is no observed price behind it.
 */
export const SPEND_WINDOW_MS = 86_400_000;
export const PER_WORKSPACE_INPUT_TOKENS_PER_DAY = 60_000_000;
export const PER_WORKSPACE_USD_PER_DAY = 25;

export const ADMISSION_QUEUE_MAX_MS = 50;
/** Covers queueing, admissions and every wave — not one pair. */
export const RANK_DEADLINE_MS = 600;

export const BREAKER_WINDOW_MS = 60_000;
export const BREAKER_SAMPLE_SIZE = 20;
export const BREAKER_FAILURE_RATIO = 0.5;
export const BREAKER_PROBE_AFTER_MS = 60_000;

export type JevWorkClass = "interactive" | "background";

export type SchedulerDecision =
  | { admitted: true }
  | { admitted: false; reason: JevDenialReason };

export type JevDenialReason =
  | "breaker-open"
  | "global-rate"
  | "workspace-rate"
  | "global-concurrency"
  | "global-token-budget"
  | "workspace-token-budget"
  | "background-share";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

interface TokenWindow {
  windowStart: number;
  tokens: number;
}

/**
 * A leaky bucket that refills continuously, so a burst is bounded by
 * capacity and the sustained rate is exactly `perSecond`.
 */
function takeFromBucket(
  bucket: Bucket,
  perSecond: number,
  capacity: number,
  now: number,
): boolean {
  const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(
    capacity,
    bucket.tokens + elapsedSeconds * perSecond,
  );
  bucket.updatedAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function takeFromTokenWindow(
  window: TokenWindow,
  limit: number,
  amount: number,
  now: number,
): boolean {
  if (now - window.windowStart >= 60_000) {
    window.windowStart = now;
    window.tokens = 0;
  }
  if (window.tokens + amount > limit) return false;
  window.tokens += amount;
  return true;
}

export class JevScheduler {
  private readonly globalBucket: Bucket;
  private readonly interactiveBucket: Bucket;
  private readonly backgroundBucket: Bucket;
  private readonly workspaceBuckets = new Map<string, Bucket>();
  private readonly globalTokens: TokenWindow;
  private readonly workspaceTokens = new Map<string, TokenWindow>();
  private inFlight = 0;
  private readonly outcomes: { at: number; ok: boolean }[] = [];
  private breakerOpenedAt: number | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {
    const at = this.now();
    this.globalBucket = { tokens: GLOBAL_BURST_CAPACITY, updatedAt: at };
    this.interactiveBucket = {
      tokens: GLOBAL_BURST_CAPACITY,
      updatedAt: at,
    };
    this.backgroundBucket = {
      tokens: Math.ceil(
        GLOBAL_BURST_CAPACITY * (1 - INTERACTIVE_RESERVED_FRACTION),
      ),
      updatedAt: at,
    };
    this.globalTokens = { windowStart: at, tokens: 0 };
  }

  /**
   * Reserve capacity for one outbound request. Returns a release handle;
   * the caller must release it whatever happens, including on cancellation.
   */
  tryAdmit(input: {
    workspaceId: string;
    workClass: JevWorkClass;
    inputTokens: number;
  }): SchedulerDecision {
    const now = this.now();

    if (this.isBreakerOpen(now)) {
      return { admitted: false, reason: "breaker-open" };
    }

    if (this.inFlight >= GLOBAL_MAX_CONCURRENT) {
      return { admitted: false, reason: "global-concurrency" };
    }

    const classBucket =
      input.workClass === "interactive"
        ? this.interactiveBucket
        : this.backgroundBucket;
    const classPerSecond =
      input.workClass === "interactive"
        ? GLOBAL_REQUESTS_PER_SECOND * INTERACTIVE_RESERVED_FRACTION
        : GLOBAL_REQUESTS_PER_SECOND * (1 - INTERACTIVE_RESERVED_FRACTION);
    const classCapacity =
      input.workClass === "interactive"
        ? GLOBAL_BURST_CAPACITY
        : Math.ceil(
            GLOBAL_BURST_CAPACITY * (1 - INTERACTIVE_RESERVED_FRACTION),
          );

    // Background work takes only from its own share. It cannot fall through
    // to the global bucket when its share is spent.
    if (!takeFromBucket(classBucket, classPerSecond, classCapacity, now)) {
      return {
        admitted: false,
        reason:
          input.workClass === "background" ? "background-share" : "global-rate",
      };
    }

    if (
      !takeFromBucket(
        this.globalBucket,
        GLOBAL_REQUESTS_PER_SECOND,
        GLOBAL_BURST_CAPACITY,
        now,
      )
    ) {
      return { admitted: false, reason: "global-rate" };
    }

    const workspaceBucket = this.workspaceBuckets.get(input.workspaceId) ?? {
      tokens: PER_WORKSPACE_BURST,
      updatedAt: now,
    };
    this.workspaceBuckets.set(input.workspaceId, workspaceBucket);
    if (
      !takeFromBucket(
        workspaceBucket,
        PER_WORKSPACE_REQUESTS_PER_SECOND,
        PER_WORKSPACE_BURST,
        now,
      )
    ) {
      return { admitted: false, reason: "workspace-rate" };
    }

    if (
      !takeFromTokenWindow(
        this.globalTokens,
        GLOBAL_INPUT_TOKENS_PER_MINUTE,
        input.inputTokens,
        now,
      )
    ) {
      return { admitted: false, reason: "global-token-budget" };
    }

    const workspaceTokens = this.workspaceTokens.get(input.workspaceId) ?? {
      windowStart: now,
      tokens: 0,
    };
    this.workspaceTokens.set(input.workspaceId, workspaceTokens);
    if (
      !takeFromTokenWindow(
        workspaceTokens,
        PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
        input.inputTokens,
        now,
      )
    ) {
      return { admitted: false, reason: "workspace-token-budget" };
    }

    this.inFlight += 1;
    return { admitted: true };
  }

  /**
   * Give back a reservation that never became a provider call.
   *
   * Admission was granted, then something local refused before dispatch — a
   * denied authorization, an expired admission, a rejected request body. The
   * slot must come back, but the breaker must not hear about it: it exists to
   * notice *the provider* failing, and counting our own refusals against it
   * opened it during a run that never reached the network once.
   */
  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }

  /**
   * Settle a reservation that was dispatched. The token cost is deliberately
   * not returned: a dispatched request is charged whether it succeeded,
   * failed or the reader navigated away.
   */
  settle(outcome: "ok" | "failed"): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const now = this.now();
    this.outcomes.push({ at: now, ok: outcome === "ok" });
    while (
      this.outcomes.length > 0 &&
      now - this.outcomes[0].at > BREAKER_WINDOW_MS
    ) {
      this.outcomes.shift();
    }
    if (this.outcomes.length > BREAKER_SAMPLE_SIZE) {
      this.outcomes.splice(0, this.outcomes.length - BREAKER_SAMPLE_SIZE);
    }

    if (this.outcomes.length >= BREAKER_SAMPLE_SIZE) {
      const failures = this.outcomes.filter((entry) => !entry.ok).length;
      if (failures / this.outcomes.length >= BREAKER_FAILURE_RATIO) {
        this.breakerOpenedAt = now;
        this.outcomes.length = 0;
      }
    }
  }

  isBreakerOpen(now = this.now()): boolean {
    if (this.breakerOpenedAt === null) return false;
    if (now - this.breakerOpenedAt >= BREAKER_PROBE_AFTER_MS) {
      // Half-open: let the next request through and judge by its outcome.
      this.breakerOpenedAt = null;
      return false;
    }
    return true;
  }

  get concurrentRequests(): number {
    return this.inFlight;
  }
}

/** One scheduler per runtime, because the quotas are per provider. */
let sharedScheduler: JevScheduler | null = null;

export function getJevScheduler(): JevScheduler {
  sharedScheduler ??= new JevScheduler();
  return sharedScheduler;
}

/** Tests only: drop the shared scheduler so state does not leak between them. */
export function resetJevScheduler(): void {
  sharedScheduler = null;
}
