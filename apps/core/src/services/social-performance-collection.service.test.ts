import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  attempt: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: {
      findMany: mocks.accounts,
      updateMany: mocks.attempt,
    },
  },
}));
vi.mock("@/services/social-account-statistics.service", () => ({
  refreshSocialAccountStatistics: mocks.refresh,
}));

import { collectSocialPerformance } from "./social-performance-collection.service";

const account = {
  id: "connection",
  projectId: "project",
  project: { workspaceId: "workspace" },
  status: "active",
  performanceRefreshRequestedAt: null,
  performanceRefreshAttemptedAt: null,
  performanceHeadFetchedAt: null,
  statistics: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.accounts.mockResolvedValue([account]);
  mocks.refresh.mockResolvedValue({
    account: { statistics: { historyComplete: false } },
  });
  mocks.attempt.mockResolvedValue({ count: 1 });
});
describe("periodic performance collection", () => {
  it("uses the stored project/workspace, respects cancellation, and isolates a revoked account", async () => {
    mocks.accounts.mockResolvedValue([account, { ...account, id: "next" }]);
    mocks.refresh.mockRejectedValueOnce(new Error("revoked"));
    mocks.refresh.mockResolvedValueOnce({
      account: { statistics: { historyComplete: true } },
    });
    const result = await collectSocialPerformance({
      shouldContinue: () => true,
    });
    expect(result).toMatchObject({
      accountsProcessed: 1,
      accountsFailed: 1,
      pagesCollected: 1,
    });
    expect(mocks.refresh).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        connectionId: "next",
        projectId: "project",
        workspaceId: "workspace",
      }),
    );
    expect(mocks.attempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "connection",
          status: "active",
          performanceRefreshAttemptedAt: null,
        },
      }),
    );
    mocks.refresh.mockClear();
    await collectSocialPerformance({ shouldContinue: () => false });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("resumes only the server's cached incomplete history cursor", async () => {
    mocks.accounts.mockResolvedValue([
      {
        ...account,
        statistics: {
          metrics: [],
          fetchedAt: null,
          refreshAttemptedAt: null,
          error: null,
          historyNextCursor: "next-page",
          historyComplete: false,
          historyFetchedAt: null,
          historyError: null,
        },
      },
    ]);
    await collectSocialPerformance({ shouldContinue: () => true });
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ continueHistory: true }),
    );
  });
  it("refreshes the daily profile/head independently of an archive cursor and advances scheduling before slow work", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    mocks.accounts.mockResolvedValue([
      {
        ...account,
        performanceRefreshAttemptedAt: new Date("2026-10-07T23:00:00Z"),
        performanceHeadFetchedAt: new Date("2026-10-07T23:00:00Z"),
      },
      {
        ...account,
        id: "same-day",
        performanceRefreshAttemptedAt: new Date("2026-10-08T09:00:00Z"),
        performanceHeadFetchedAt: new Date("2026-10-08T09:00:00Z"),
      },
    ]);
    const signal = new AbortController().signal;
    await collectSocialPerformance({
      shouldContinue: () => true,
      abortSignal: signal,
      now,
    });
    expect(mocks.refresh).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ refreshHead: true, signal }),
    );
    expect(mocks.refresh).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ refreshHead: false }),
    );
    expect(mocks.attempt.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.refresh.mock.invocationCallOrder[0],
    );
  });
  it("retries incomplete history after a transient historyError without waiting for UTC midnight", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    mocks.accounts.mockResolvedValue([
      {
        ...account,
        performanceRefreshAttemptedAt: new Date("2026-10-08T10:00:00Z"),
        performanceHeadFetchedAt: new Date("2026-10-08T10:00:00Z"),
        statistics: {
          metrics: [],
          fetchedAt: "2026-10-08T10:00:00Z",
          refreshAttemptedAt: "2026-10-08T10:00:00Z",
          error: null,
          historyNextCursor: "page-2",
          historyComplete: false,
          historyFetchedAt: "2026-10-08T10:00:00Z",
          historyError: "429 rate limit",
        },
      },
    ]);
    await collectSocialPerformance({ shouldContinue: () => true, now });
    expect(
      mocks.accounts.mock.calls[0][0].where.OR[3].AND[1].OR,
    ).toContainEqual({
      statistics: { path: ["historyComplete"], equals: false },
    });
    expect(JSON.stringify(mocks.accounts.mock.calls[0][0].where)).not.toContain(
      "historyError",
    );
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ continueHistory: true, refreshHead: false }),
    );
  });

  it("retries a cancelled daily head despite today's attempt and retains an errored archive cursor", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    mocks.accounts.mockResolvedValue([
      {
        ...account,
        performanceRefreshAttemptedAt: new Date("2026-10-08T09:00:00Z"),
        performanceHeadFetchedAt: new Date("2026-10-07T09:00:00Z"),
        statistics: {
          metrics: [],
          fetchedAt: null,
          refreshAttemptedAt: null,
          error: null,
          historyNextCursor: "archive-page-20",
          historyComplete: false,
          historyFetchedAt: null,
          historyError: "Temporary outage",
        },
      },
    ]);
    await collectSocialPerformance({ shouldContinue: () => true, now });
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshHead: true, continueHistory: true }),
    );
    expect(mocks.accounts.mock.calls[0][0].where.OR[0]).toEqual({
      performanceRefreshRequestedAt: { not: null },
    });
    expect(mocks.accounts.mock.calls[0][0].where.OR[3].AND).toContainEqual({
      performanceRefreshAttemptedAt: { lte: new Date("2026-10-08T11:00:00Z") },
    });
    expect(
      mocks.accounts.mock.calls[0][0].where.OR[3].AND[1].OR,
    ).toContainEqual({
      performanceHeadFetchedAt: { lt: new Date("2026-10-08T00:00:00Z") },
    });
  });
  it("treats deadline cancellation as interruption and retains a scheduling checkpoint without failing later accounts", async () => {
    const controller = new AbortController();
    mocks.accounts.mockResolvedValue([account, { ...account, id: "next" }]);
    mocks.refresh.mockImplementationOnce(() => {
      controller.abort();
      throw new DOMException("Deadline", "AbortError");
    });
    const result = await collectSocialPerformance({
      shouldContinue: () => true,
      abortSignal: controller.signal,
    });
    expect(result).toMatchObject({
      accountsProcessed: 0,
      accountsFailed: 0,
      pagesCollected: 0,
    });
    expect(mocks.attempt).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("asks only for active accounts and does not cap the candidate set", async () => {
    await collectSocialPerformance({ shouldContinue: () => true });
    expect(mocks.accounts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active" }),
      }),
    );
    expect(mocks.accounts.mock.calls[0][0].take).toBeUndefined();
  });

  it("skips a recently failed account until the backoff window elapses", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    mocks.accounts.mockResolvedValue([
      {
        ...account,
        status: "active",
        performanceRefreshAttemptedAt: new Date("2026-10-08T11:50:00Z"),
        statistics: {
          metrics: [],
          fetchedAt: "2026-10-08T10:00:00Z",
          refreshAttemptedAt: "2026-10-08T11:50:00Z",
          error: "provider timeout",
          historyNextCursor: null,
          historyComplete: true,
          historyFetchedAt: null,
          historyError: null,
        },
      },
    ]);
    const result = await collectSocialPerformance({
      shouldContinue: () => true,
      now,
    });
    expect(result.accountsSkippedBackoff).toBe(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.attempt).not.toHaveBeenCalled();
  });

  it("does not apply backoff when the account is dirty", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    mocks.accounts.mockResolvedValue([
      {
        ...account,
        performanceRefreshRequestedAt: new Date("2026-10-08T11:55:00Z"),
        performanceRefreshAttemptedAt: new Date("2026-10-08T11:50:00Z"),
        statistics: {
          metrics: [],
          fetchedAt: "2026-10-08T10:00:00Z",
          refreshAttemptedAt: "2026-10-08T11:50:00Z",
          error: "provider timeout",
          historyNextCursor: null,
          historyComplete: true,
          historyFetchedAt: null,
          historyError: null,
        },
      },
    ]);
    await collectSocialPerformance({ shouldContinue: () => true, now });
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("retries after the backoff window and marks unauthorized accounts for reauth", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    mocks.accounts.mockResolvedValue([
      {
        ...account,
        status: "active",
        performanceRefreshAttemptedAt: new Date("2026-10-08T11:00:00Z"),
        statistics: {
          metrics: [],
          fetchedAt: "2026-10-08T08:00:00Z",
          refreshAttemptedAt: "2026-10-08T11:00:00Z",
          error: "provider timeout",
          historyNextCursor: null,
          historyComplete: true,
          historyFetchedAt: null,
          historyError: null,
        },
      },
    ]);
    mocks.refresh.mockRejectedValueOnce(
      new Error("Unauthorized: token expired"),
    );
    const result = await collectSocialPerformance({
      shouldContinue: () => true,
      now,
    });
    expect(result.accountsSkippedReauth).toBe(1);
    expect(result.accountsFailed).toBe(0);
    expect(mocks.attempt).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "connection", status: "active" },
        data: { status: "reauthorization_required" },
      }),
    );
  });

  it("stops at the deadline after processing as many accounts as fit", async () => {
    mocks.accounts.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        ...account,
        id: `connection-${index}`,
        status: "active",
      })),
    );
    let started = 0;
    mocks.refresh.mockImplementation(() => {
      started += 1;
      return { account: { statistics: { historyComplete: true } } };
    });
    const result = await collectSocialPerformance({
      shouldContinue: () => started < 3,
    });
    expect(result.accountsProcessed).toBe(3);
    expect(mocks.refresh).toHaveBeenCalledTimes(3);
  });
});
