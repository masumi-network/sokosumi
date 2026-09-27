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
 * **What it protects, and what it does not.** The admission transaction
 * re-reads the actor's scope epoch under the advisory lock and refuses if
 * it has moved, so a granted row attests: *at `admittedAt`, this actor's
 * scope hashed to this epoch*. This window bounds how long that attestation
 * may be acted on.
 *
 * **That is not an authorization control, and an earlier version of this
 * comment implied it was.** `resolveScopeEpoch` hashes the count of
 * evidence-scope rows and their `scopeVersion`s, and `scopeVersion` is
 * never advanced anywhere in the application — the only write to
 * `file_evidence_scope` outside creation sets the backfill cursor. So the
 * epoch moves when a scope is *added* and stays byte-identical when access
 * is taken away: removing a user from an organization, deleting a file, a
 * task changing visibility. `evidence-scope.ts` says this at length and is
 * the authority; this comment previously contradicted it, which is worse
 * than saying nothing, because a docstring arguing for a property the code
 * does not have is what the next reader will trust.
 *
 * On the label-suggest path it is weaker still, to the point of being
 * inert: `resolveScopeEpoch` aggregates only over the source kinds
 * `sourceKindsForActor` admits for the actor's kind, and `"worker"` — the
 * kind that path builds — is in no entry of `SOURCE_ACTOR_CEILING`, so the
 * aggregate covers no rows and the epoch is a constant. The comparison
 * below can never deny for that caller. Pinned by "cannot refuse anything
 * for the actor the label pipeline uses" in
 * `file-suggestions.postgres.test.ts`.
 *
 * What the window is actually for is quota hygiene: a grant counted against
 * the ceilings should not sit around indefinitely waiting to be spent. That
 * argument is real and is the one below. Authorization is re-evaluated from
 * the canonical source on every read, which is where the defence lives.
 *
 * **What it has to cover.** The time from the database committing the grant
 * to this process deciding to dispatch — `grantTransitMs` in the ranking
 * log, emitted on every ranking. Two runs against the preview, and all
 * percentiles here are nearest-rank:
 *
 * - `d0b5ab652`, warm, 163 grants over 80 rankings: p50 4, p90 6, p95 11,
 *   p99 31, **max 43**.
 * - `f00c908bf`, including the first search against a freshly deployed
 *   instance, 104 grants over 52 rankings: p50 3, p90 4, p95 5, p99 12,
 *   **max 13**.
 *
 * The full datasets are in `evidence/ADMISSION-WINDOW-MEASUREMENT.md`.
 *
 * **Why 50 was wrong.** At steady state, warm, uncontended, the worst
 * observed transit was 43 ms against a 50 ms window. A bound the happy path
 * clears by 7 ms is not a bound; it is a coin toss that usually lands the
 * right way up.
 *
 * **Why 2000.** Not a percentile — sizing on p99 (31) would leave the same
 * kind of thin margin the 50 had. The number comes from a property instead:
 * it must exceed `RANK_DEADLINE_MS` (600), so that on the interactive path
 * the rank deadline always binds first and this window can never be the
 * reason a dispatch is refused that the deadline would have allowed. 2000
 * gives 3.3× over that deadline, 65× over warm p99 and 47× over the worst
 * transit ever observed.
 *
 * The prior going in was "low seconds" and this lands inside it, but the
 * measurement did not confirm the prior: nothing observed needed seconds,
 * or came close. The seconds are headroom bought cheaply, justified by the
 * ordering property rather than by the data.
 *
 * **Why the increase is negligible.** It adds 1,950 ms during which a
 * counted grant may still be spent. The same admission row already counts
 * against `PER_WORKSPACE_INPUT_TOKENS_PER_MINUTE` for a full 60,000 ms from
 * `admittedAt`, so the system already accepts a 60-second consequence from
 * one admission; this is 3.25% of that. Both windows are quota hygiene,
 * which is why the comparison is apt — the earlier version of this passage
 * contrasted them as protecting "different things" and called only one an
 * authorization control, which was the same mistake corrected above.
 *
 * **What this does not fix.** Cold-start rankings still fall back, at the
 * rank deadline, which is by design — see `RANK_DEADLINE_MS`. The cause is
 * provider latency under our own 600 ms cap, **not** admission transit: the
 * first search against the freshly deployed `f00c908bf` fell back with
 * `rank-deadline:aborted` at 616 ms while its two grants had taken 13 ms and
 * 9 ms. An earlier draft of this docstring attributed the cold fallback to a
 * ~721 ms admission round trip, on one observation from `405ddcadd` that
 * this run did not reproduce and that nothing since has come near. That
 * attribution is withdrawn; see the evidence file for what remains of it.
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
 * without consulting this window, so on that path the bound above is not
 * enforced.
 *
 * An earlier version of this paragraph justified that by saying enforcing
 * it would turn a slow grant into a deferred indexing job, "a product
 * decision rather than a tidy-up". **That was simply false**: the adjacent
 * `!admission` branch in the same function already calls
 * `deferFileIndexJob`, so deferring is exactly what that path does and no
 * decision was being held open.
 *
 * The real reason to leave it is that enforcing it buys nothing. The window
 * is quota hygiene, not authorization — see above — and the background path
 * dispatches immediately after admission with no user waiting, so a grant
 * that arrives a second stale has cost nobody anything. Adding the check
 * there would convert a handful of good suggestion jobs into deferrals in
 * exchange for a property the epoch cannot provide.
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
         * The module contract above puts the linearization point at *the
         * transaction that writes the row*. The window was previously opened
         * at function entry, so it was spent on our own work before the
         * caller ever held the grant: a `resolveScopeEpoch` round trip, then
         * queueing on `ADMISSION_LOCK_KEY` behind the rest of its own wave,
         * then an aggregate scan. Against the 50 ms the window then was,
         * that could exhaust it outright, so the caller's
         * `isAdmissionDispatchable` check was already false and the grant was
         * **born expired**. Observed in preprod as
         * `reason: "admission-expired"` with `elapsedMs` of 405 and 511 —
         * both under the 600 ms rank deadline, which is why a deadline could
         * never have explained it.
         *
         * **An earlier version of this comment said widening the window
         * would have been the wrong fix, "a security property, not a tuning
         * constant". The window has since been widened, from 50 ms to
         * 2,000 — see `ADMISSION_VALID_MS`, which argues it out and does not
         * repeat the claim.** The part that survives is narrower and is the
         * reason this line stays where it is: moving where the window
         * *starts* is free, because it removes self-inflicted delay without
         * touching the bound at all. Widening is not free; it is a real,
         * argued trade, and the two fixes are independent. Doing the cheap
         * one did not license skipping the argument for the expensive one,
         * and this comment previously read as though it forbade it.
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
         * inside the window. That removed two of the three pre-commit
         * consumers the comment above names and left the third, three lines
         * below naming it.
         *
         * Minting here leaves only COMMIT plus the return hop to fra1 inside
         * the window. **That has since been measured** rather than asserted,
         * which is what `grantTransitMs` in the ranking log is for: 163
         * grants at p50 4 ms and max 43 ms warm, and 104 grants at p50 3 ms
         * and max 13 ms on a freshly deployed instance. They fit, and they
         * fitted inside the old 50 ms too — with 7 ms to spare at the worst
         * observed, which is why the window moved anyway. See
         * `ADMISSION_VALID_MS`.
         *
         * Raw SQL because Prisma cannot express a server-side
         * `clock_timestamp()` in `create`, and `CURRENT_TIMESTAMP` — which is
         * what the column default uses — is transaction-start and would
         * reintroduce the bug.
         *
         * `clock_timestamp()` is **volatile**, so calling it twice reads the
         * clock twice. Each reading rounds independently into `TIMESTAMP(3)`,
         * and when the pair straddles a millisecond boundary the stored gap
         * is one millisecond over. Measured on this schema while the window
         * was 50: 51 rather than 50 in 3 of 4000 trials. That is an
         * intermittent test failure nobody reproduces and a window that is
         * quietly wrong by a millisecond. The CTE takes one reading and
         * derives both columns from it — 4000 of 4000 exact — which is what
         * lets the test below assert equality against
         * `ADMISSION_VALID_MS` at all. The defect and the fix are
         * independent of what the constant happens to be; the trial counts
         * are quoted at the value they were run under.
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
