/**
 * Social account sync — synthesized contract (snapshot-as-cache).
 *
 * Public surface (3 operations):
 *   socialSyncReadModel          — derive UI freshness from stored columns
 *   requestSocialAccountRefresh  — mark dirty; never talks to providers
 *   runDueSocialAccountSync      — sole writer; cron / waitUntil
 *
 * Reads are Prisma. Composio lives only inside the writer
 * (`refreshSocialAccountStatistics` + connection probe).
 *
 * Module map:
 *   social-account-sync.ts                 — this file (owner)
 *   social-account-statistics.service.ts   — provider page writer (internal)
 *   social-performance.service.ts          — cache aggregation
 *   project-social-connections.service.ts  — Prisma list (no Composio)
 *   account-statistics.ts                  — provider adapter
 *
 * Schema: ProjectSocialConnection.performanceRefreshRequestedAt (dirty flag).
 * Lease: compare-and-set on performanceRefreshAttemptedAt.
 */

import type { Result } from "neverthrow";

export const SOCIAL_SYNC_FRESH_MS = 3_600_000;
export const SOCIAL_SYNC_LEASE_MS = 300_000;

export type SocialSyncTrigger =
  | "cron"
  | "manual"
  | "connect"
  | "stale_auto"
  | "reauth_resume";

export type SocialSyncStatus =
  | "fresh"
  | "stale"
  | "queued"
  | "running"
  | "reauth_required"
  | "partial";

export interface SocialSyncReadModel {
  status: SocialSyncStatus;
  dataFetchedAt: string | null;
  headFetchedAt: string | null;
  dataVersion: string;
  mayAutoRequest: boolean;
  lastError: string | null;
  partialWarnings: string[];
}

export interface SocialSyncStoredRow {
  status: string;
  performanceHeadFetchedAt: Date | null;
  performanceRefreshAttemptedAt: Date | null;
  performanceRefreshRequestedAt: Date | null;
  statistics: {
    fetchedAt: string | null;
    historyFetchedAt: string | null;
    historyError: string | null;
    metricWarning: string | null;
    error: string | null;
  } | null;
}

export type SocialSyncServiceError =
  | { code: "not_found"; connectionId: string }
  | { code: "reauth_required"; connectionId: string }
  | { code: "forbidden"; reason: string };

export interface RequestSocialAccountRefreshInput {
  projectId: string;
  workspaceId: string;
  connectionId: string;
  trigger: SocialSyncTrigger;
}

export interface RequestSocialAccountRefreshResult {
  connectionId: string;
  sync: SocialSyncReadModel;
  accepted: boolean;
}

export interface RunDueSocialAccountSyncInput {
  shouldContinue: () => boolean;
  abortSignal?: AbortSignal;
  now?: Date;
  /** When set, only this connection is eligible (connect / waitUntil). */
  connectionId?: string;
}

export interface RunDueSocialAccountSyncResult {
  accountsProcessed: number;
  pagesCollected: number;
  accountsCompleted: number;
  accountsFailed: number;
  accountsSkippedReauth: number;
  accountsSkippedBackoff: number;
  rateLimitHits: number;
}

/**
 * Pure. One owner of freshness: stored columns + statistics errors.
 * Web must not re-derive 1h/5m thresholds.
 */
export function socialSyncReadModel(
  _row: SocialSyncStoredRow,
  _now?: Date,
): SocialSyncReadModel {
  throw new Error("not implemented");
  // TODO: reauth_required if row.status !== active
  // TODO: running if attemptedAt within LEASE and (requestedAt >= attemptedAt or head stale)
  // TODO: queued if requestedAt > attemptedAt (or attemptedAt null)
  // TODO: partial if historyError/metricWarning and we still have a head
  // TODO: fresh if headFetchedAt within FRESH_MS
  // TODO: else stale; mayAutoRequest = active && !running && !queued
}

/**
 * Mark the connection dirty. Never calls Composio or the statistics writer.
 * Idempotent: a second request while already dirty/running just returns the
 * current read model.
 */
export async function requestSocialAccountRefresh(
  _input: RequestSocialAccountRefreshInput,
): Promise<Result<RequestSocialAccountRefreshResult, SocialSyncServiceError>> {
  throw new Error("not implemented");
  // TODO: load connection in project/workspace; 404 / reauth
  // TODO: updateMany set performanceRefreshRequestedAt = now where id + active
  // TODO: return stored account + socialSyncReadModel (queued)
}

/**
 * Sole provider writer. Claims dirty/stale/incomplete active rows with
 * compare-and-set on attemptedAt, then delegates one-or-more pages to
 * refreshSocialAccountStatistics. Crash mid-slice: lease expires, next
 * cron reclaims. Duplicate cron: updateMany count 0, skip.
 */
export async function runDueSocialAccountSync(
  _input: RunDueSocialAccountSyncInput,
): Promise<RunDueSocialAccountSyncResult> {
  throw new Error("not implemented");
  // TODO: select active rows: requestedAt dirty OR head stale OR history incomplete OR never attempted
  // TODO: skip backoff from consecutiveFailures in statistics JSON (writer-owned)
  // TODO: claim: updateMany attemptedAt=now where id and (attemptedAt null or older than lease or requestedAt > attemptedAt)
  // TODO: probe connection health once (Composio); 401 → reauthorization_required
  // TODO: refreshSocialAccountStatistics (head then history pages under deadline)
  // TODO: clear requestedAt when requestedAt <= attemptedAt after a successful head
  // TODO: never wipe SocialAccountPost on partial provider failure
}

/**
 * Connect / Vercel after-response: mark dirty, then run the same writer.
 * requestRefresh itself still does not await providers.
 */
export async function scheduleSocialAccountRefresh(
  _input: RequestSocialAccountRefreshInput,
): Promise<void> {
  throw new Error("not implemented");
  // TODO: requestSocialAccountRefresh then waitUntil(runDue({ connectionId }))
}
