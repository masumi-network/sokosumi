import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
  refresh: vi.fn(),
  provider: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: {
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock("@/services/project-social-connections.service", () => ({
  listProjectSocialConnections: mocks.listAccounts,
}));
vi.mock("@/services/social-account-statistics.service", () => ({
  refreshSocialAccountStatistics: mocks.refresh,
}));
vi.mock("@/clients/social-post-providers/account-statistics", () => ({
  fetchSocialAccountStatisticsPage: mocks.provider,
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import {
  requestSocialAccountRefresh,
  runDueSocialAccountSync,
  socialSyncReadModel,
} from "./social-account-sync";

const projectId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-10-08T12:00:00Z");
const staleHead = new Date("2026-10-08T08:00:00Z");
const requestedAt = new Date("2026-10-08T11:50:00Z");

const summary = {
  id: connectionId,
  provider: "x" as const,
  externalHandle: "launch",
  displayName: "Launch",
  avatarUrl: null,
  status: "active",
  connectedAt: now,
  disconnectedAt: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listAccounts.mockResolvedValue([summary]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findFirst.mockResolvedValue({
    status: "active",
    performanceHeadFetchedAt: staleHead,
    performanceRefreshAttemptedAt: staleHead,
    performanceRefreshRequestedAt: requestedAt,
    statistics: {
      metrics: [],
      fetchedAt: staleHead.toISOString(),
      refreshAttemptedAt: staleHead.toISOString(),
      error: null,
      historyNextCursor: null,
      historyComplete: true,
      historyFetchedAt: staleHead.toISOString(),
      historyError: null,
      metricWarning: null,
    },
  });
  mocks.refresh.mockResolvedValue({
    account: { statistics: { historyComplete: true } },
  });
});

describe("socialSyncReadModel", () => {
  it("is queued and may not auto-request while a refresh is dirty", () => {
    const sync = socialSyncReadModel(
      {
        status: "active",
        performanceHeadFetchedAt: staleHead,
        performanceRefreshAttemptedAt: staleHead,
        performanceRefreshRequestedAt: requestedAt,
        statistics: {
          fetchedAt: staleHead.toISOString(),
          historyFetchedAt: staleHead.toISOString(),
          historyError: null,
          metricWarning: null,
          error: null,
        },
      },
      now,
    );
    expect(sync.status).toBe("queued");
    expect(sync.mayAutoRequest).toBe(false);
    expect(sync.dataFetchedAt).toBe(staleHead.toISOString());
  });

  it("is stale and may auto-request when the head is older than an hour", () => {
    const sync = socialSyncReadModel(
      {
        status: "active",
        performanceHeadFetchedAt: new Date("2026-10-08T10:00:00Z"),
        performanceRefreshAttemptedAt: new Date("2026-10-08T10:00:00Z"),
        performanceRefreshRequestedAt: null,
        statistics: {
          fetchedAt: "2026-10-08T10:00:00.000Z",
          historyFetchedAt: "2026-10-08T10:00:00.000Z",
          historyError: null,
          metricWarning: null,
          error: null,
        },
      },
      now,
    );
    expect(sync.status).toBe("stale");
    expect(sync.mayAutoRequest).toBe(true);
  });

  it("is running while a lease is open on a dirty or stale account", () => {
    const sync = socialSyncReadModel(
      {
        status: "active",
        performanceHeadFetchedAt: staleHead,
        performanceRefreshAttemptedAt: new Date("2026-10-08T11:58:00Z"),
        performanceRefreshRequestedAt: requestedAt,
        statistics: {
          fetchedAt: staleHead.toISOString(),
          historyFetchedAt: staleHead.toISOString(),
          historyError: null,
          metricWarning: null,
          error: null,
        },
      },
      now,
    );
    expect(sync.status).toBe("running");
    expect(sync.mayAutoRequest).toBe(false);
  });

  it("treats missing dates as null instead of throwing", () => {
    const sync = socialSyncReadModel(
      {
        status: "active",
        statistics: null,
      },
      now,
    );
    expect(sync.status).toBe("stale");
    expect(sync.mayAutoRequest).toBe(true);
    expect(sync.headFetchedAt).toBeNull();
    expect(sync.dataFetchedAt).toBeNull();
  });

  it("is partial when stored warnings exist beside usable data", () => {
    const sync = socialSyncReadModel(
      {
        status: "active",
        performanceHeadFetchedAt: now,
        performanceRefreshAttemptedAt: now,
        performanceRefreshRequestedAt: null,
        statistics: {
          fetchedAt: now.toISOString(),
          historyFetchedAt: now.toISOString(),
          historyError: null,
          metricWarning: "Some post insights are unavailable.",
          error: null,
        },
      },
      now,
    );
    expect(sync.status).toBe("partial");
    expect(sync.partialWarnings).toEqual([
      "Some post insights are unavailable.",
    ]);
  });
});

describe("requestSocialAccountRefresh", () => {
  it("marks the account dirty and never calls the writer or providers", async () => {
    const result = await requestSocialAccountRefresh({
      projectId,
      workspaceId,
      connectionId,
      trigger: "manual",
    });
    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toMatchObject({
      connectionId,
      accepted: true,
      sync: {
        status: "queued",
        mayAutoRequest: false,
        dataFetchedAt: staleHead.toISOString(),
      },
    });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: connectionId,
        projectId,
        project: { workspaceId },
        status: "active",
      },
      data: { performanceRefreshRequestedAt: expect.any(Date) },
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects a missing or inactive account without writing", async () => {
    mocks.listAccounts.mockResolvedValueOnce([]);
    const missing = await requestSocialAccountRefresh({
      projectId,
      workspaceId,
      connectionId,
      trigger: "manual",
    });
    expect(missing.isErr()).toBe(true);
    if (missing.isOk()) return;
    expect(missing.error).toEqual({ code: "not_found", connectionId });
    mocks.listAccounts.mockResolvedValueOnce([
      { ...summary, status: "reauthorization_required" },
    ]);
    const reauth = await requestSocialAccountRefresh({
      projectId,
      workspaceId,
      connectionId,
      trigger: "manual",
    });
    expect(reauth.isErr()).toBe(true);
    if (reauth.isOk()) return;
    expect(reauth.error).toEqual({ code: "reauth_required", connectionId });
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("runDueSocialAccountSync", () => {
  it("is the sole writer and claims with a CAS on attemptedAt", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: connectionId,
        projectId,
        status: "active",
        project: { workspaceId },
        performanceRefreshRequestedAt: requestedAt,
        performanceRefreshAttemptedAt: staleHead,
        performanceHeadFetchedAt: staleHead,
        statistics: null,
      },
    ]);
    const result = await runDueSocialAccountSync({
      shouldContinue: () => true,
      now,
      connectionId,
    });
    expect(result.accountsProcessed).toBe(1);
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId,
        projectId,
        workspaceId,
        refreshHead: true,
      }),
    );
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: connectionId,
          status: "active",
          performanceRefreshAttemptedAt: staleHead,
        },
      }),
    );
  });

  it("retries historyError after backoff instead of waiting for UTC midnight", async () => {
    mocks.findMany.mockResolvedValue([
      {
        id: connectionId,
        projectId,
        status: "active",
        project: { workspaceId },
        performanceRefreshRequestedAt: null,
        performanceRefreshAttemptedAt: new Date("2026-10-08T11:58:00Z"),
        performanceHeadFetchedAt: staleHead,
        statistics: {
          metrics: [],
          fetchedAt: staleHead.toISOString(),
          refreshAttemptedAt: staleHead.toISOString(),
          error: null,
          historyNextCursor: "page-2",
          historyComplete: false,
          historyFetchedAt: staleHead.toISOString(),
          historyError: "429 rate limited",
          metricWarning: null,
          consecutiveFailures: 0,
        },
      },
    ]);
    const skipped = await runDueSocialAccountSync({
      shouldContinue: () => true,
      now,
      connectionId,
    });
    expect(skipped.accountsSkippedBackoff).toBe(1);
    expect(mocks.refresh).not.toHaveBeenCalled();

    const later = new Date("2026-10-08T12:10:00Z");
    mocks.findMany.mockResolvedValue([
      {
        id: connectionId,
        projectId,
        status: "active",
        project: { workspaceId },
        performanceRefreshRequestedAt: null,
        performanceRefreshAttemptedAt: new Date("2026-10-08T11:58:00Z"),
        performanceHeadFetchedAt: staleHead,
        statistics: {
          metrics: [],
          fetchedAt: staleHead.toISOString(),
          refreshAttemptedAt: staleHead.toISOString(),
          error: null,
          historyNextCursor: "page-2",
          historyComplete: false,
          historyFetchedAt: staleHead.toISOString(),
          historyError: "429 rate limited",
          metricWarning: null,
          consecutiveFailures: 0,
        },
      },
    ]);
    mocks.refresh.mockResolvedValue({
      account: {
        statistics: {
          historyComplete: false,
          historyNextCursor: "page-3",
          historyError: null,
        },
      },
    });
    const retried = await runDueSocialAccountSync({
      shouldContinue: () => true,
      now: later,
      connectionId,
    });
    expect(retried.accountsSkippedBackoff).toBe(0);
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
