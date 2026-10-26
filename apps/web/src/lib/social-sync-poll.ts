import { SOCIAL_SYNC_LEASE_MS } from "@sokosumi/utils";

interface SyncAccount {
  sync?: { status: string; dataVersion?: string } | null;
  statistics?: { refreshAttemptedAt?: Date | string | null } | null;
}

export function isSocialSyncInFlight(
  account: SyncAccount,
  now = Date.now(),
): boolean {
  if (account.sync?.status === "queued") return true;
  if (account.sync?.status !== "running") return false;
  // Core's version ends with the live attempt; the snapshot updates only after the provider returns.
  const attemptedAt =
    account.sync.dataVersion?.split("|").at(-1) ||
    account.statistics?.refreshAttemptedAt;
  return (
    attemptedAt != null &&
    now - new Date(attemptedAt).getTime() < SOCIAL_SYNC_LEASE_MS
  );
}

export function socialSyncPollIntervalMs(
  accounts: readonly SyncAccount[],
): number | false {
  return accounts.some((account) => isSocialSyncInFlight(account))
    ? 10_000
    : false;
}
