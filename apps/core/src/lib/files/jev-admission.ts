import * as Sentry from "@sentry/node";
import { PrismaRaw } from "@sokosumi/database/client";
import { v7 as uuidv7 } from "uuid";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { fileActorFingerprint } from "@/lib/files/actor";
import { resolveScopeEpoch } from "@/lib/files/evidence-scope";
import {
  GLOBAL_INPUT_TOKENS_PER_MINUTE,
  GLOBAL_REQUESTS_PER_MINUTE,
  PER_WORKSPACE_INPUT_TOKENS_PER_DAY,
  PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE,
  PER_WORKSPACE_USD_PER_DAY,
  SPEND_WINDOW_MS,
} from "@/lib/files/jev-scheduler";

/**
 * One admission per outbound request, in every wave — not one per query.
 *
 * The contract is **authorized admission**, and it is deliberately weaker
 * than "no socket send after revocation commits". The linearization point is
 * the short transaction that writes the admission row after re-reading the
 * actor's current scope epoch. If revocation commits first, no admission is
 * granted and nothing is sent. If the admission commits first, that request
 * is in flight: its socket may open after revocation commits, and bytes
 * already transmitted cannot be recalled. Nothing here claims otherwise.
 *
 * The row records a digest of the serialized request, never the request.
 */

/**
 * An admission that has not dispatched within this window must reauthorize.
 *
 * **What it protects.** The admission transaction re-reads the actor's scope
 * epoch under the advisory lock and refuses if it has moved, so a granted
 * row attests: *at `admittedAt`, this actor's authorization scope hashed to
 * this epoch*. This window bounds how long that attestation may be acted on
 * — the maximum lag between a revocation committing and Files ceasing to
 * send that actor's document excerpts to the provider. It is deliberately
 * weaker than "no socket send after revocation commits"; the module contract
 * above says so and this number does not change that.
 *
 * **What it has to cover.** The time from the database committing the grant
 * to this process deciding to dispatch — `grantTransitMs` in the ranking
 * log, emitted on every ranking. Measured on `d0b5ab652` against the
 * preview, 163 grants over 81 rankings: p50 4 ms, p90 6 ms, p99 18 ms,
 * **max 43 ms**. One cold-start observation, from the gate capture at
 * `405ddcadd`: roughly **721 ms**. The full dataset and how it was gathered
 * are in `evidence/ADMISSION-WINDOW-MEASUREMENT.md`.
 *
 * **Why 50 was wrong**, and the warm number is the damning one rather than
 * the cold one: at steady state, warm, uncontended, the worst observed
 * transit was 43 ms against a 50 ms window. A bound the happy path nearly
 * misses is not a bound. The cold observation then exceeds it by 14×.
 *
 * **Why 2000.** Not a percentile: a p99 over that population is 18 ms, and
 * sizing on it would rebuild the present failure, because the population is
 * almost entirely warm and cold starts are the case that fails. The number
 * comes from a property instead — it must exceed `RANK_DEADLINE_MS` (600),
 * so that on the interactive path the rank deadline always binds first and
 * this window can never be the reason a dispatch is refused that the
 * deadline would have allowed. 2000 gives 3.3× over that deadline, 2.8× over
 * the single cold observation, and 46× over warm p99. A single sample of a
 * cold-start tail earns a multiple, not a percentage.
 *
 * The prior going in was "low seconds" and this lands inside it, but the
 * measurement did not confirm the prior: nothing observed needed seconds.
 * 1,000 would cover everything seen. The second second is headroom.
 *
 * **Why the increase is negligible.** It adds 1,950 ms of authorization
 * staleness. The same admission row already counts against
 * `PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE` for a full 60,000 ms from
 * `admittedAt`, so the system is already built to accept a 60-second
 * consequence from one admission; this is 3.25% of that. That is an argument
 * about magnitude and not about equivalence — the two windows protect
 * different things, and the quota window is not an authorization control.
 * The honest version of the claim is: whatever exposure a revocation racing
 * an in-flight search creates, it is not meaningfully different at 2 s than
 * at 50 ms, because the content in question was on the reader's screen a
 * moment earlier and the search result itself is unaffected by any window.
 *
 * **What this does not fix.** Cold-start rankings still fall back, at the
 * rank deadline, which is by design — see `RANK_DEADLINE_MS`.
 *
 * **What it costs in signal.** `recordJevDispatch` with
 * `expired-before-dispatch` should now approach never on the interactive
 * path. That was the trace the original defect was found through, and it is
 * replaced by a better one: `grantTransitMs` on every ranking shows the
 * distribution rather than only its failures.
 *
 * **One asymmetry a reader should know about.** `isAdmissionDispatchable`
 * has exactly one production call site, in `jev-ranking.ts`. The
 * label-suggest path in `file-suggestions.service.ts` admits and dispatches
 * without consulting this window at all, so on that path the bound above is
 * not enforced. Left as found and reported rather than changed here:
 * enforcing it would turn a slow background grant into a deferred indexing
 * job, which is a product decision rather than a tidy-up.
 */
export const ADMISSION_VALID_MS = 2_000;

/**
 * The window the shared ceiling counts over. One minute, matching the
 * per-minute constants it enforces.
 */
const SHARED_WINDOW_MS = 60_000;

/**
 * The advisory lock every admission takes.
 *
 * One key for the whole ceiling, not one per workspace: two of the three
 * limits are global, so a per-workspace lock would not serialize the thing
 * being counted. An arbitrary constant — it only has to be unique among the
 * advisory locks this application takes.
 */
export const ADMISSION_LOCK_KEY = 8_143_072_901_553_001n;

/** How long an admission row is kept after its window has passed. */
const ADMISSION_RETENTION_DAYS = 30;

export type AdmissionDenial =
  | "epoch-changed"
  | "shared-global-rate"
  | "shared-global-token-budget"
  | "shared-workspace-token-budget"
  | "shared-workspace-daily-tokens"
  | "shared-workspace-daily-spend";

export interface AdmissionGrant {
  id: string;
  /**
   * When the database minted this grant, in the database's own clock.
   *
   * Returned rather than derived from `expiresAt - ADMISSION_VALID_MS`
   * because a caller measuring how long the grant took to arrive must not
   * have to assume the constant that minted it is the constant it is
   * compiled against.
   */
  admittedAt: Date;
  expiresAt: Date;
}

export async function admitJevRequest(input: {
  workspaceId: string;
  actor: FileActor;
  purpose: "search-rank" | "related-rank" | "label-suggest";
  payloadDigest: string;
  inputTokens: number;
  model: string;
  /** The epoch this request was prepared under; a change denies admission. */
  preparedEpoch: string;
}): Promise<AdmissionGrant | null> {
  // Re-read the authorization clocks at the admission point rather than
  // trusting the value retrieval used a moment ago.
  const currentEpoch = await resolveScopeEpoch({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });
  if (currentEpoch !== input.preparedEpoch) return null;

  /**
   * The ceiling that actually holds across runtimes.
   *
   * `jev-scheduler` counts in memory, so on a platform that runs many
   * instances its per-minute numbers were a per-process share wearing a
   * global name: ten instances meant ten times the stated rate. This counts
   * the admissions themselves, which are rows, so every runtime sees the
   * same total.
   *
   * ## Why a lock and not `SERIALIZABLE`
   *
   * This aggregates over a table and then inserts into it, which is the
   * textbook write-skew shape. Under SSI each transaction's aggregate takes
   * predicate locks that the others' inserts fall inside, so Postgres aborts
   * all but one — and a search fires `PER_QUERY_MAX_CONCURRENT` admissions in
   * a single wave, so one ordinary query conflicted with *itself*: four of
   * six came back as denials. Because the count filters on `admittedAt`
   * alone it could not use the `(workspaceId, admittedAt)` index either, so
   * the sequential scan's predicate lock was relation-wide and one tenant's
   * traffic denied another's.
   *
   * Retrying the aborts would have been the wrong shape: the contention is
   * not rare, it is every wave. Taking one transaction-scoped advisory lock
   * makes concurrent admissions *queue* for a few milliseconds instead of
   * aborting, which is what a shared ceiling means anyway — the ceiling is
   * global, so the check has to be serialized somewhere, and a lock does it
   * without throwing work away. `READ COMMITTED` is then correct: each
   * statement takes a fresh snapshot, and the count runs after the lock is
   * held, so it sees every admission committed before it.
   */
  try {
    return await prisma.$transaction<AdmissionGrant | null>(
      async (tx) => {
        // Held until this transaction ends, so the count and the insert that
        // depends on it cannot interleave with another admission's.
        await tx.$executeRaw(
          PrismaRaw.sql`SELECT pg_advisory_xact_lock(${ADMISSION_LOCK_KEY})`,
        );

        /**
         * The clock starts here, and the position of this line is the whole
         * fix.
         *
         * `ADMISSION_VALID_MS` is 50, and the module contract above puts the
         * linearization point at *the transaction that writes the row*. The
         * window was previously opened at function entry, so it was spent on
         * our own work before the caller ever held the grant: a
         * `resolveScopeEpoch` round trip, then queueing on
         * `ADMISSION_LOCK_KEY` behind the rest of its own wave, then an
         * aggregate scan. On a cold pool that exceeds 50 ms comfortably, so
         * the caller's `isAdmissionDispatchable` check was already false and
         * the grant was **born expired**. Observed in preprod as
         * `reason: "admission-expired"` with `elapsedMs` of 405 and 511 —
         * both under the 600 ms rank deadline, which is why a deadline could
         * never have explained it.
         *
         * Widening the 50 ms would have been the wrong fix: it is a security
         * property, not a tuning constant. It bounds how long a grant issued
         * before a revocation commits may still open a socket. Moving where
         * the window *starts* preserves that bound exactly and removes only
         * the self-defeat.
         *
         * `clock_timestamp()`, not `now()`: `now()` is fixed at transaction
         * start in Postgres, so it would be captured **before** the lock wait
         * and reintroduce the bug it is here to remove.
         */
        const [clock] = await tx.$queryRaw<{ committedAt: Date }[]>(
          PrismaRaw.sql`SELECT clock_timestamp() AS "committedAt"`,
        );
        const committedAt = clock?.committedAt ?? new Date();
        // Only the counting windows. They are 60 s and 24 h, compared
        // against DB-written `admittedAt` columns in the same clock domain,
        // so a few milliseconds here buys no correctness and moving them
        // would buy none either.
        const windowStart = new Date(committedAt.getTime() - SHARED_WINDOW_MS);
        const dayStart = new Date(committedAt.getTime() - SPEND_WINDOW_MS);

        /**
         * One scan, five numbers. The outer filter is the *day* window and
         * the per-minute figures are `FILTER`ed out of the same rows, so
         * adding the daily budgets costs no extra round trip and no extra
         * lock — the same reason the per-minute count lives here.
         */
        const [usage] = await tx.$queryRaw<
          {
            requests: bigint;
            globalTokens: bigint;
            workspaceTokens: bigint;
            workspaceDayTokens: bigint;
            workspaceDaySpend: number;
          }[]
        >(PrismaRaw.sql`
          SELECT
            count(*) FILTER (
              WHERE "admittedAt" > ${windowStart}
            ) AS "requests",
            coalesce(sum("inputTokens") FILTER (
              WHERE "admittedAt" > ${windowStart}
            ), 0) AS "globalTokens",
            coalesce(sum("inputTokens") FILTER (
              WHERE "admittedAt" > ${windowStart}
                AND "workspaceId" = ${input.workspaceId}::uuid
            ), 0) AS "workspaceTokens",
            coalesce(sum("inputTokens") FILTER (
              WHERE "workspaceId" = ${input.workspaceId}::uuid
            ), 0) AS "workspaceDayTokens",
            coalesce(sum("costUsd") FILTER (
              WHERE "workspaceId" = ${input.workspaceId}::uuid
            ), 0)::float8 AS "workspaceDaySpend"
          FROM file_authorization_admission
          WHERE "admittedAt" > ${dayStart}
        `);

        const requests = Number(usage?.requests ?? 0);
        const globalTokens = Number(usage?.globalTokens ?? 0);
        const workspaceTokens = Number(usage?.workspaceTokens ?? 0);
        const workspaceDayTokens = Number(usage?.workspaceDayTokens ?? 0);
        const workspaceDaySpend = Number(usage?.workspaceDaySpend ?? 0);

        if (requests + 1 > GLOBAL_REQUESTS_PER_MINUTE) return null;
        if (globalTokens + input.inputTokens > GLOBAL_INPUT_TOKENS_PER_MINUTE) {
          return null;
        }
        if (
          workspaceTokens + input.inputTokens >
          PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE
        ) {
          return null;
        }
        // The daily budgets. Refusing here is the same answer a per-minute
        // denial already gives: the caller falls back to deterministic
        // order, gives its scheduler slot back with `release()`, and tells
        // the breaker nothing — this is our decision, not the provider
        // failing.
        if (
          workspaceDayTokens + input.inputTokens >
          PER_WORKSPACE_INPUT_TOKENS_PER_DAY
        ) {
          return null;
        }
        if (workspaceDaySpend >= PER_WORKSPACE_USD_PER_DAY) return null;

        /**
         * Both timestamps are minted by the INSERT itself.
         *
         * The previous attempt took `clock_timestamp()` right after the lock
         * and called that "the row write". It was not: the aggregate scan
         * above, this insert, the COMMIT and the return hop all still sat
         * inside the 50 ms. That removed two of the three pre-commit
         * consumers the comment above names and left the third, three lines
         * below naming it.
         *
         * Minting here leaves only COMMIT plus the return hop to fra1 inside
         * the window. **Whether those two fit in 50 ms is not yet known** —
         * the `grantAgeMs` recorded on the `admission-expired` path is there
         * to measure it rather than to assert it.
         *
         * Raw SQL because Prisma cannot express a server-side
         * `clock_timestamp()` in `create`, and `CURRENT_TIMESTAMP` — which is
         * what the column default uses — is transaction-start and would
         * reintroduce the bug.
         *
         * `clock_timestamp()` is **volatile**, so calling it twice reads the
         * clock twice. Each reading rounds independently into `TIMESTAMP(3)`,
         * and when the pair straddles a millisecond boundary the stored gap
         * is 51 rather than 50. Measured on this schema: 3 in 4000 trials.
         * That is an intermittent test failure nobody reproduces and a
         * window that is quietly wrong by a millisecond. The CTE takes one
         * reading and derives both columns from it — 4000 of 4000 at exactly
         * 50 — which is what lets the test below assert equality at all.
         *
         * Three further sharp edges, all load-bearing:
         *
         * - the table is `file_authorization_admission` via `@@map`, not the
         *   model name, and its columns are camelCase so they stay quoted;
         * - `id` is `@default(uuid(7))`, which is a **Prisma-side** default
         *   and not a DDL one, so a raw insert must supply it or violate
         *   NOT NULL. Minted here as v7; `gen_random_uuid()` is v4 and would
         *   quietly drop the time ordering the rest of the table has;
         * - `admittedAt` and `expiresAt` are `TIMESTAMP(3)` — **without**
         *   time zone — while `clock_timestamp()` returns `timestamptz`.
         *   The implicit cast resolves through the session `TimeZone`, so on
         *   a session that is not UTC this would write local wall time into
         *   a column the application reads back as UTC, and the error would
         *   be hours rather than milliseconds. `AT TIME ZONE 'UTC'` is
         *   explicit for that reason and must not be removed. Prisma's own
         *   writes are safe only because both sides of the round trip are
         *   symmetric; hand-writing one side breaks that symmetry.
         */
        const [row] = await tx.$queryRaw<
          { id: string; admittedAt: Date; expiresAt: Date }[]
        >(
          PrismaRaw.sql`
            WITH t AS (SELECT clock_timestamp() AS ts)
            INSERT INTO "file_authorization_admission" (
              "id", "workspaceId", "actorFingerprint", "epochVector",
              "purpose", "payloadDigest", "provider", "model", "inputTokens",
              "admittedAt", "expiresAt"
            )
            SELECT
              ${uuidv7()}::uuid,
              ${input.workspaceId}::uuid,
              ${fileActorFingerprint(input.actor, input.workspaceId)},
              ${currentEpoch},
              ${input.purpose},
              ${input.payloadDigest},
              'vercel-ai-gateway',
              ${input.model},
              ${input.inputTokens},
              t.ts AT TIME ZONE 'UTC',
              (t.ts + ${ADMISSION_VALID_MS} * interval '1 millisecond')
                AT TIME ZONE 'UTC'
            FROM t
            RETURNING "id", "admittedAt", "expiresAt"
          `,
        );
        if (!row) return null;
        return {
          id: row.id,
          admittedAt: row.admittedAt,
          expiresAt: row.expiresAt,
        };
      },
      { isolationLevel: "ReadCommitted" },
    );
  } catch (error) {
    // Refusing is still the safe answer — the caller falls back to the
    // deterministic order — but it is not the *same* answer as being over
    // quota, and the previous version could not tell the two apart. A pool
    // timeout, a dead connection and a constraint violation all read as
    // "this workspace has spent its minute", silently. Report it, so a
    // database problem does not look like ordinary throttling on a
    // dashboard of denials.
    Sentry.captureException(error, {
      tags: { area: "files-jev-admission" },
      extra: {
        workspaceId: input.workspaceId,
        purpose: input.purpose,
        consequence:
          "Admission refused for an infrastructure reason, not a quota one. " +
          "The caller falls back to deterministic ranking.",
      },
    });
    return null;
  }
}

/**
 * Drop admissions nobody will read again.
 *
 * Only the last `SHARED_WINDOW_MS` is ever counted, and the rest is an audit
 * trail. Left alone the table grows by millions of rows a day at the stated
 * ceiling, and every admission has to scan past all of them.
 */
export async function pruneExpiredAdmissions(input?: {
  now?: Date;
  retentionDays?: number;
}): Promise<number> {
  const now = input?.now ?? new Date();
  const cutoff = new Date(
    now.getTime() -
      (input?.retentionDays ?? ADMISSION_RETENTION_DAYS) * 86_400_000,
  );
  const { count } = await prisma.fileAuthorizationAdmission.deleteMany({
    where: { admittedAt: { lt: cutoff } },
  });
  return count;
}

export async function recordJevDispatch(input: {
  admissionId: string;
  outcome: string;
  /**
   * What the provider said this call cost. Persisted because the daily
   * spend budget sums it — it was parsed out of `providerMetadata` and then
   * thrown away, so nothing could enforce a budget in money.
   */
  costUsd?: string | null;
  now?: Date;
}): Promise<void> {
  await prisma.fileAuthorizationAdmission.update({
    where: { id: input.admissionId },
    data: {
      dispatchedAt: input.now ?? new Date(),
      outcome: input.outcome,
      ...(input.costUsd == null ? {} : { costUsd: input.costUsd }),
    },
  });
}

/** True while the grant may still start a dispatch. */
export function isAdmissionDispatchable(
  grant: AdmissionGrant,
  now = new Date(),
): boolean {
  return grant.expiresAt.getTime() > now.getTime();
}
