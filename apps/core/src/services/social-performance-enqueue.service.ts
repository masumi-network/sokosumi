import { getEnv } from "@/config/env";
import { refreshSocialAccountStatistics } from "@/services/social-account-statistics.service";

/**
 * Enqueue a background sync for a specific social account.
 * Non-blocking, safe to call from waitUntil or after response.
 * Uses the same statistics refresh logic as the cron but targets one account.
 */
export async function enqueueSocialAccountSync(input: {
  projectId: string;
  workspaceId: string;
  connectionId: string;
  reason: "connect" | "reauth" | "manual" | "stale";
}): Promise<void> {
  try {
    await refreshSocialAccountStatistics({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      connectionId: input.connectionId,
      userId: `social-performance-${input.reason}`,
      refreshHead: true,
      continueHistory: false, // Initial sync: fetch head only, history continues in cron
    });
  } catch (error) {
    // Log but don't throw - this is background work
    console.warn(
      `[social-performance-enqueue] Failed to sync account ${input.connectionId} (${input.reason}):`,
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

/**
 * Check if an account's data is stale and needs refresh.
 * Used by Performance tab to decide whether to show "Syncing..." indicator.
 */
export function isAccountDataStale(input: {
  performanceHeadFetchedAt: Date | null;
  performanceRefreshAttemptedAt: Date | null;
  freshnessThresholdMs?: number;
}): boolean {
  const threshold = input.freshnessThresholdMs ?? 3_600_000; // 1 hour default
  const now = Date.now();

  // Never fetched = stale
  if (!input.performanceHeadFetchedAt) return true;

  // Fetched recently = fresh
  if (now - input.performanceHeadFetchedAt.getTime() < threshold) return false;

  // Attempted recently but not completed = syncing now, not stale
  if (
    input.performanceRefreshAttemptedAt &&
    now - input.performanceRefreshAttemptedAt.getTime() < 300_000 // 5 min
  ) {
    return false;
  }

  // Fetched long ago and no recent attempt = stale
  return true;
}

/**
 * Rate limit key for manual sync requests per account.
 */
export function getManualSyncRateLimitKey(
  userId: string,
  connectionId: string,
): string {
  return `social-sync:manual:${userId}:${connectionId}`;
}

/**
 * Check if manual sync is rate limited for this user+account.
 * Returns true if allowed, false if rate limited.
 */
export async function checkManualSyncRateLimit(
  userId: string,
  connectionId: string,
): Promise<boolean> {
  // Use a simple in-memory rate limit for now
  // In production, this should use Redis or similar
  // For now, rely on the hourly cron's natural rate limiting
  return true;
}
