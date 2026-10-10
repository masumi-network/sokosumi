import { describe, expect, it } from "vitest";

import {
  SOCIAL_SYNC_FRESH_MS,
  SOCIAL_SYNC_LEASE_MS,
  type SocialSyncStoredRow,
  socialSyncReadModel,
} from "./social-sync-read";

const now = new Date("2026-10-08T12:00:00.000Z");

function row(
  overrides: Partial<SocialSyncStoredRow> = {},
): SocialSyncStoredRow {
  return {
    status: "active",
    performanceHeadFetchedAt: now,
    performanceRefreshAttemptedAt: now,
    performanceRefreshRequestedAt: null,
    statistics: {
      fetchedAt: now.toISOString(),
      historyFetchedAt: now.toISOString(),
      historyError: null,
      metricWarning: null,
      error: null,
    },
    ...overrides,
  };
}

describe("socialSyncReadModel", () => {
  it("is reauth_required and may not auto-request when the account needs reconnect", () => {
    const sync = socialSyncReadModel(
      row({ status: "reauthorization_required" }),
      now,
    );
    expect(sync.status).toBe("reauth_required");
    expect(sync.mayAutoRequest).toBe(false);
  });

  it("is stale and may not auto-request when the account is not active", () => {
    const sync = socialSyncReadModel(row({ status: "disconnected" }), now);
    expect(sync.status).toBe("stale");
    expect(sync.mayAutoRequest).toBe(false);
  });

  it("is fresh when the head is within the hour and there are no warnings", () => {
    const sync = socialSyncReadModel(row(), now);
    expect(sync.status).toBe("fresh");
    expect(sync.mayAutoRequest).toBe(false);
  });

  it("prefers fetchedAt, then historyFetchedAt, and prefers error over historyError", () => {
    const withFetch = socialSyncReadModel(
      row({
        statistics: {
          fetchedAt: "2026-10-08T11:00:00.000Z",
          historyFetchedAt: "2026-10-08T10:00:00.000Z",
          historyError: "history failed",
          metricWarning: null,
          error: "head failed",
        },
      }),
      now,
    );
    expect(withFetch.dataFetchedAt).toBe("2026-10-08T11:00:00.000Z");
    expect(withFetch.lastError).toBe("head failed");

    const historyOnly = socialSyncReadModel(
      row({
        statistics: {
          fetchedAt: null,
          historyFetchedAt: "2026-10-08T10:00:00.000Z",
          historyError: "history failed",
          metricWarning: null,
          error: null,
        },
      }),
      now,
    );
    expect(historyOnly.dataFetchedAt).toBe("2026-10-08T10:00:00.000Z");
    expect(historyOnly.lastError).toBe("history failed");
  });

  it("is partial and may auto-request when warnings sit on stale usable data", () => {
    const staleHead = new Date(now.getTime() - SOCIAL_SYNC_FRESH_MS);
    const sync = socialSyncReadModel(
      row({
        performanceHeadFetchedAt: staleHead,
        performanceRefreshAttemptedAt: staleHead,
        statistics: {
          fetchedAt: staleHead.toISOString(),
          historyFetchedAt: staleHead.toISOString(),
          historyError: "Some days are missing.",
          metricWarning: null,
          error: null,
        },
      }),
      now,
    );
    expect(sync.status).toBe("partial");
    expect(sync.mayAutoRequest).toBe(true);
    expect(sync.partialWarnings).toEqual(["Some days are missing."]);
  });

  it("is queued after the lease expires on a dirty refresh", () => {
    const attemptedAt = new Date(now.getTime() - SOCIAL_SYNC_LEASE_MS);
    const requestedAt = new Date(attemptedAt.getTime() + 1);
    const sync = socialSyncReadModel(
      row({
        performanceHeadFetchedAt: new Date("2026-10-08T08:00:00.000Z"),
        performanceRefreshAttemptedAt: attemptedAt,
        performanceRefreshRequestedAt: requestedAt,
      }),
      now,
    );
    expect(sync.status).toBe("queued");
    expect(sync.mayAutoRequest).toBe(false);
  });

  it("stays fresh when an open lease already finished and the head is current", () => {
    const attemptedAt = new Date(now.getTime() - 60_000);
    const requestedAt = new Date(attemptedAt.getTime() - 1);
    const sync = socialSyncReadModel(
      row({
        performanceRefreshAttemptedAt: attemptedAt,
        performanceRefreshRequestedAt: requestedAt,
      }),
      now,
    );
    expect(sync.status).toBe("fresh");
    expect(sync.mayAutoRequest).toBe(false);
  });

  it("joins head, data, requested, and attempted times into dataVersion", () => {
    const head = new Date("2026-10-08T11:00:00.000Z");
    const requested = new Date("2026-10-08T11:10:00.000Z");
    const attempted = new Date("2026-10-08T11:12:00.000Z");
    const sync = socialSyncReadModel(
      row({
        performanceHeadFetchedAt: head,
        performanceRefreshRequestedAt: requested,
        performanceRefreshAttemptedAt: attempted,
        statistics: {
          fetchedAt: "2026-10-08T11:01:00.000Z",
          historyFetchedAt: null,
          historyError: null,
          metricWarning: null,
          error: null,
        },
      }),
      now,
    );
    expect(sync.dataVersion).toBe(
      [
        head.toISOString(),
        "2026-10-08T11:01:00.000Z",
        requested.toISOString(),
        attempted.toISOString(),
      ].join("|"),
    );
  });
});
