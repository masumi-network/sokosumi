import * as Sentry from "@sentry/node";
import { PrismaRaw } from "@sokosumi/database/client";

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

/** An admission that has not dispatched within this window must reauthorize. */
export const ADMISSION_VALID_MS = 50;

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
const ADMISSION_LOCK_KEY = 8_143_072_901_553_001n;

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
  now?: Date;
}): Promise<AdmissionGrant | null> {
  const now = input.now ?? new Date();

  // Re-read the authorization clocks at the admission point rather than
  // trusting the value retrieval used a moment ago.
  const currentEpoch = await resolveScopeEpoch({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });
  if (currentEpoch !== input.preparedEpoch) return null;

  const expiresAt = new Date(now.getTime() + ADMISSION_VALID_MS);
  const windowStart = new Date(now.getTime() - SHARED_WINDOW_MS);
  const dayStart = new Date(now.getTime() - SPEND_WINDOW_MS);

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

        return await tx.fileAuthorizationAdmission.create({
          data: {
            workspaceId: input.workspaceId,
            actorFingerprint: fileActorFingerprint(
              input.actor,
              input.workspaceId,
            ),
            epochVector: currentEpoch,
            purpose: input.purpose,
            payloadDigest: input.payloadDigest,
            provider: "vercel-ai-gateway",
            model: input.model,
            inputTokens: input.inputTokens,
            admittedAt: now,
            expiresAt,
          },
          select: { id: true, expiresAt: true },
        });
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
