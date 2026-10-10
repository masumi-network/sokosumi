import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/services/social-account-statistics.service", () => ({
  refreshSocialAccountStatistics: mocks.refresh,
}));

import {
  enqueueSocialAccountSync,
  isAccountDataStale,
} from "./social-performance-enqueue.service";

describe("enqueueSocialAccountSync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.refresh.mockResolvedValue({ account: { statistics: null } });
  });

  it("refreshes the head for a new connection", async () => {
    await enqueueSocialAccountSync({
      projectId: "project",
      workspaceId: "workspace",
      connectionId: "connection",
      reason: "connect",
    });
    expect(mocks.refresh).toHaveBeenCalledWith({
      projectId: "project",
      workspaceId: "workspace",
      connectionId: "connection",
      userId: "social-performance-connect",
      refreshHead: true,
      continueHistory: false,
    });
  });

  it("uses the reauth actor when the account was just reconnected", async () => {
    await enqueueSocialAccountSync({
      projectId: "project",
      workspaceId: "workspace",
      connectionId: "connection",
      reason: "reauth",
    });
    expect(mocks.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "social-performance-reauth" }),
    );
  });

  it("swallows provider failures so connect/open paths stay non-blocking", async () => {
    mocks.refresh.mockRejectedValueOnce(new Error("rate limited"));
    await expect(
      enqueueSocialAccountSync({
        projectId: "project",
        workspaceId: "workspace",
        connectionId: "connection",
        reason: "stale",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("isAccountDataStale", () => {
  const now = Date.now();

  it("treats a never-fetched account as stale", () => {
    expect(
      isAccountDataStale({
        performanceHeadFetchedAt: null,
        performanceRefreshAttemptedAt: null,
      }),
    ).toBe(true);
  });

  it("treats a head fetched within the hour as fresh", () => {
    expect(
      isAccountDataStale({
        performanceHeadFetchedAt: new Date(now - 10 * 60 * 1000),
        performanceRefreshAttemptedAt: new Date(now - 10 * 60 * 1000),
      }),
    ).toBe(false);
  });

  it("does not stack another refresh while an attempt is still in flight", () => {
    expect(
      isAccountDataStale({
        performanceHeadFetchedAt: new Date(now - 2 * 60 * 60 * 1000),
        performanceRefreshAttemptedAt: new Date(now - 60 * 1000),
      }),
    ).toBe(false);
  });

  it("treats an old head with no recent attempt as stale", () => {
    expect(
      isAccountDataStale({
        performanceHeadFetchedAt: new Date(now - 2 * 60 * 60 * 1000),
        performanceRefreshAttemptedAt: new Date(now - 20 * 60 * 1000),
      }),
    ).toBe(true);
  });
});
