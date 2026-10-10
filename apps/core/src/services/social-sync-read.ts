export const SOCIAL_SYNC_FRESH_MS = 3_600_000;
export const SOCIAL_SYNC_LEASE_MS = 300_000;

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
  performanceHeadFetchedAt?: Date | null;
  performanceRefreshAttemptedAt?: Date | null;
  performanceRefreshRequestedAt?: Date | null;
  statistics: {
    fetchedAt: string | null;
    historyFetchedAt: string | null;
    historyError: string | null;
    metricWarning: string | null;
    error: string | null;
  } | null;
}

export function socialSyncReadModel(
  row: SocialSyncStoredRow,
  now = new Date(),
): SocialSyncReadModel {
  const dataFetchedAt =
    row.statistics?.fetchedAt ?? row.statistics?.historyFetchedAt ?? null;
  const headFetchedAt = row.performanceHeadFetchedAt?.toISOString() ?? null;
  const lastError =
    row.statistics?.error ?? row.statistics?.historyError ?? null;
  const partialWarnings = [
    row.statistics?.metricWarning,
    row.statistics?.historyError,
  ].filter((value): value is string => Boolean(value));
  const dataVersion = [
    headFetchedAt ?? "",
    dataFetchedAt ?? "",
    row.performanceRefreshRequestedAt?.toISOString() ?? "",
    row.performanceRefreshAttemptedAt?.toISOString() ?? "",
  ].join("|");
  const base = {
    dataFetchedAt,
    headFetchedAt,
    dataVersion,
    lastError,
    partialWarnings,
  };
  if (row.status === "reauthorization_required") {
    return { ...base, status: "reauth_required", mayAutoRequest: false };
  }
  if (row.status !== "active") {
    return { ...base, status: "stale", mayAutoRequest: false };
  }
  const requestedAt = row.performanceRefreshRequestedAt ?? null;
  const attemptedAt = row.performanceRefreshAttemptedAt ?? null;
  const headAt = row.performanceHeadFetchedAt ?? null;
  const dirty =
    requestedAt !== null &&
    (attemptedAt === null || requestedAt.getTime() > attemptedAt.getTime());
  const leaseOpen =
    attemptedAt !== null &&
    now.getTime() - attemptedAt.getTime() < SOCIAL_SYNC_LEASE_MS;
  const fresh =
    headAt !== null && now.getTime() - headAt.getTime() < SOCIAL_SYNC_FRESH_MS;
  if (leaseOpen && (dirty || !fresh)) {
    return { ...base, status: "running", mayAutoRequest: false };
  }
  if (dirty) {
    return { ...base, status: "queued", mayAutoRequest: false };
  }
  if (partialWarnings.length > 0 && (fresh || dataFetchedAt)) {
    return { ...base, status: "partial", mayAutoRequest: !fresh };
  }
  if (fresh) {
    return { ...base, status: "fresh", mayAutoRequest: false };
  }
  return { ...base, status: "stale", mayAutoRequest: true };
}
