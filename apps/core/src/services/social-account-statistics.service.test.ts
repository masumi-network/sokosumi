import { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  connections: vi.fn(),
  provider: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  count: vi.fn(),
  posts: vi.fn(),
  cursor: vi.fn(),
  transaction: vi.fn(),
  snapshot: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: { findMany: mocks.connections },
    socialAccountPost: { findMany: mocks.posts, findFirst: mocks.cursor },
  },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: mocks.transaction,
}));
vi.mock("@/services/project-social-connections.service", () => ({
  listProjectSocialConnections: mocks.listAccounts,
}));
vi.mock("@/clients/social-post-providers/account-statistics", () => ({
  fetchSocialAccountStatisticsPage: mocks.provider,
}));

import {
  listSocialAccountStatistics,
  refreshSocialAccountStatistics,
} from "./social-account-statistics.service";

const projectId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const postId = "44444444-4444-4444-8444-444444444444";
const scope = { projectId, workspaceId };
const account = {
  id: connectionId,
  provider: "x",
  externalHandle: "launch",
  displayName: "Launch",
  avatarUrl: null,
  status: "active",
  connectedAt: new Date("2026-10-01T12:00:00Z"),
  disconnectedAt: null,
};
const metric = {
  key: "followers",
  value: 0,
  period: "lifetime",
  unit: "count",
};
const previous = {
  metrics: [{ ...metric, value: 100 }],
  fetchedAt: "2026-10-01T12:00:00Z",
  refreshAttemptedAt: null,
  error: null,
  historyNextCursor: "provider-page-2",
  historyComplete: false,
  historyFetchedAt: "2026-10-01T12:00:00Z",
  historyError: null,
};
const connection = {
  ...account,
  projectId,
  externalAccountId: "external-account",
  composioConnectedAccountId: "ca-one",
  connectorUserId: "connector",
  statistics: previous,
  performanceHeadFetchedAt: new Date("2026-10-01T12:00:00Z"),
  performanceRefreshAttemptedAt: new Date("2026-10-01T12:00:00Z"),
  performanceRefreshRequestedAt: null,
  _count: { accountPosts: 40 },
};
const metrics = {
  views: null,
  impressions: 100,
  likes: 0,
  comments: null,
  shares: null,
  saves: null,
};
const providerPost = {
  externalId: "provider-authored",
  text: "Written outside Sokosumi",
  publishedAt: "2026-10-01T12:00:00Z",
  url: "https://x.com/launch/status/123",
  metrics,
  additionalMetrics: [
    { key: "quotes", value: 3, period: "lifetime", unit: "count" },
  ],
};
const page = {
  accountMetrics: [metric],
  accountError: null,
  posts: [providerPost],
  nextCursor: "next-page",
  historyError: null,
};
const cachedPost = {
  ...providerPost,
  id: postId,
  connectionId,
  fetchedAt: new Date("2026-10-01T12:00:00Z"),
  connection: { provider: "x" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listAccounts.mockResolvedValue([account]);
  mocks.connections.mockResolvedValue([connection]);
  mocks.posts.mockResolvedValue([cachedPost]);
  mocks.cursor.mockResolvedValue({ id: postId });
  mocks.provider.mockResolvedValue(page);
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.count.mockResolvedValue(41);
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      projectSocialConnection: { updateMany: mocks.update },
      socialAccountPost: {
        upsert: mocks.upsert,
        count: mocks.count,
        findMany: mocks.posts,
      },
      socialPerformanceSnapshot: { upsert: mocks.snapshot },
    }),
  );
});

describe("Social account statistics", () => {
  it("refreshes daily latest posts and profile without replacing the archive cursor", async () => {
    mocks.provider
      .mockResolvedValueOnce({ ...page, nextCursor: "archive-page-3" })
      .mockResolvedValueOnce({
        ...page,
        posts: [{ ...providerPost, externalId: "newest-post" }, providerPost],
        nextCursor: "head-page-2",
        accountMetrics: null,
      });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "sync",
      continueHistory: true,
      refreshHead: true,
    });
    expect(mocks.provider).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        cursor: "provider-page-2",
        includeProfile: true,
      }),
    );
    expect(mocks.provider).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: null, includeProfile: false }),
    );
    expect(result.account.statistics).toMatchObject({
      historyNextCursor: "archive-page-3",
      historyComplete: false,
      metrics: [metric],
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(
      mocks.update.mock.calls[0][0].data.performanceHeadFetchedAt,
    ).toBeInstanceOf(Date);
    expect(mocks.snapshot.mock.calls[0][0].create.profileFetchedAt).toEqual(
      new Date(result.account.statistics?.fetchedAt ?? ""),
    );
  });
  it("retains failed archive progress when a separate overlapping head succeeds", async () => {
    mocks.provider
      .mockResolvedValueOnce({
        ...page,
        posts: [],
        nextCursor: null,
        historyError: "Archive unavailable",
      })
      .mockResolvedValueOnce({
        ...page,
        posts: [{ ...providerPost, externalId: "newest-post" }, providerPost],
        nextCursor: "head-page-2",
        accountMetrics: null,
      });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "sync",
      continueHistory: true,
      refreshHead: true,
    });
    expect(result.account.statistics).toMatchObject({
      historyNextCursor: "provider-page-2",
      historyComplete: false,
      historyError: "Archive unavailable",
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(
      mocks.upsert.mock.calls[0][0].create.fetchedAt.getTime(),
    ).toBeGreaterThan(new Date(previous.historyFetchedAt).getTime());
  });
  it("keeps fresh continuation metrics when the daily latest-post read fails", async () => {
    mocks.provider.mockResolvedValueOnce(page).mockResolvedValueOnce({
      ...page,
      accountMetrics: null,
      posts: [],
      nextCursor: null,
      historyError: "Latest posts unavailable",
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "sync",
      continueHistory: true,
      refreshHead: true,
    });
    expect(result.account.statistics).toMatchObject({
      historyNextCursor: "next-page",
      historyError: null,
      metricWarning: "Latest posts unavailable",
    });
    expect(mocks.upsert.mock.calls[0][0].update).toHaveProperty("metrics");
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty(
      "performanceHeadFetchedAt",
    );
  });
  it("forwards cancellation and never converts an interrupted provider read into failed cached statistics", async () => {
    const controller = new AbortController();
    mocks.provider.mockImplementationOnce(() => {
      controller.abort();
      throw new DOMException("Deadline", "AbortError");
    });
    await expect(
      refreshSocialAccountStatistics({
        ...scope,
        connectionId,
        userId: "sync",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it("retains previously measured private X clicks with their original observation time while updating public counters", async () => {
    mocks.posts.mockResolvedValue([
      {
        ...cachedPost,
        additionalMetrics: [
          {
            key: "url_link_clicks",
            value: 7,
            period: "lifetime",
            unit: "count",
          },
          {
            key: "organic_impression_count",
            value: 80,
            period: "lifetime:2026-09-30T12:00:00.000Z",
            unit: "count",
          },
        ],
      },
    ]);
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        {
          ...providerPost,
          contentType: "image",
          postKind: "quote",
          media: [
            {
              kind: "image",
              url: "https://pbs.twimg.com/image.jpg",
              thumbnailUrl: null,
            },
          ],
          additionalMetrics: [
            {
              key: "url_link_clicks",
              value: null,
              period: "lifetime",
              unit: "count",
            },
          ],
        },
      ],
    });
    await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          contentType: "image",
          postKind: "quote",
          media: [
            {
              kind: "image",
              url: "https://pbs.twimg.com/image.jpg",
              thumbnailUrl: null,
            },
          ],
          metrics,
          additionalMetrics: [
            {
              key: "url_link_clicks",
              value: 7,
              period: "lifetime:2026-10-01T12:00:00.000Z",
              unit: "count",
            },
            {
              key: "organic_impression_count",
              value: 80,
              period: "lifetime:2026-09-30T12:00:00.000Z",
              unit: "count",
            },
          ],
        }),
      }),
    );
  });
  it("returns cached external posts and independent account totals without provider history calls", async () => {
    const publishedFrom = new Date("2026-10-01T00:00:00Z");
    const result = await listSocialAccountStatistics({
      ...scope,
      connectionId,
      provider: "x",
      publishedFrom,
      limit: 1,
    });
    expect(result.accounts[0]).toMatchObject({
      postCount: 40,
      statistics: previous,
    });
    expect(result.posts[0]).toMatchObject({
      externalId: "provider-authored",
      text: "Written outside Sokosumi",
      metrics,
    });
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId: { in: [connectionId] },
          publishedAt: { gte: publishedFrom },
        },
        take: 2,
      }),
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("serves stored posts while a refresh is queued and never calls providers", async () => {
    const requestedAt = new Date("2026-10-08T11:50:00Z");
    const fetchedAt = new Date("2026-10-08T08:00:00Z");
    mocks.connections.mockResolvedValue([
      {
        ...connection,
        performanceHeadFetchedAt: fetchedAt,
        performanceRefreshAttemptedAt: fetchedAt,
        performanceRefreshRequestedAt: requestedAt,
      },
    ]);
    const result = await listSocialAccountStatistics({
      ...scope,
      connectionId,
    });
    expect(result.accounts[0]?.sync).toMatchObject({
      status: "queued",
      mayAutoRequest: false,
      dataFetchedAt: previous.fetchedAt,
    });
    expect(result.posts[0]?.externalId).toBe("provider-authored");
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("pages cached history and keeps the account totals on every page", async () => {
    const second = {
      ...cachedPost,
      id: "55555555-5555-4555-8555-555555555555",
    };
    mocks.posts.mockResolvedValue([cachedPost, second]);
    const result = await listSocialAccountStatistics({ ...scope, limit: 1 });
    expect(result.posts).toHaveLength(1);
    expect(result.nextCursor).toBe(postId);
    expect(result.accounts[0].postCount).toBe(40);
  });
  it("blocks cross-workspace reads before fetching raw cached records", async () => {
    mocks.listAccounts.mockRejectedValue(new Error("Project not found"));
    await expect(listSocialAccountStatistics(scope)).rejects.toThrow(
      "Project not found",
    );
    expect(mocks.connections).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("rejects an account or cached cursor outside the authorized filters", async () => {
    await expect(
      listSocialAccountStatistics({ ...scope, connectionId: postId }),
    ).rejects.toThrow("connection not found");
    mocks.cursor.mockResolvedValue(null);
    await expect(
      listSocialAccountStatistics({ ...scope, cursor: postId }),
    ).rejects.toThrow("outside the selected account history");
    expect(mocks.posts).not.toHaveBeenCalled();
  });
  it("refreshes the account and imports provider posts as read-only cache records", async () => {
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(mocks.provider).toHaveBeenCalledWith({
      provider: "x",
      connectedAccountId: "ca-one",
      executorUserId: "connector",
      externalAccountId: "external-account",
      externalHandle: "launch",
      cursor: null,
      includeProfile: true,
    });
    expect(result.account.statistics?.metrics).toEqual([metric]);
    expect(result.account.statistics?.historyComplete).toBe(false);
    expect(result.account.postCount).toBe(41);
    expect(result.importedPostCount).toBe(1);
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId_externalId: {
            connectionId,
            externalId: providerPost.externalId,
          },
        },
        create: expect.objectContaining({
          connectionId,
          text: providerPost.text,
          metrics,
          additionalMetrics: providerPost.additionalMetrics,
        }),
      }),
    );
    expect(mocks.update.mock.calls[0][0].where).toMatchObject({
      projectId,
      status: "active",
      composioConnectedAccountId: "ca-one",
      externalAccountId: "external-account",
      connectorUserId: "connector",
      statistics: { equals: previous },
    });
  });
  it("uses only the stored cursor for one continuation page and preserves the profile timestamp", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      accountMetrics: null,
      nextCursor: null,
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
      continueHistory: true,
    });
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "provider-page-2",
        includeProfile: false,
      }),
    );
    expect(result.account.statistics).toMatchObject({
      metrics: previous.metrics,
      fetchedAt: previous.fetchedAt,
      historyComplete: true,
      historyNextCursor: null,
    });
  });
  it("does not contact a provider after known history exhaustion", async () => {
    mocks.connections.mockResolvedValue([
      {
        ...connection,
        statistics: {
          ...previous,
          historyComplete: true,
          historyNextCursor: null,
        },
      },
    ]);
    expect(
      (
        await refreshSocialAccountStatistics({
          ...scope,
          connectionId,
          userId: "reader",
          continueHistory: true,
        })
      ).importedPostCount,
    ).toBe(0);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("keeps account metrics when history is unsupported and makes the failure explicit", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [],
      nextCursor: null,
      historyError: "This provider does not expose author history.",
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(result.account.statistics).toMatchObject({
      metrics: [metric],
      historyComplete: false,
      historyError: "This provider does not expose author history.",
      historyNextCursor: previous.historyNextCursor,
      historyFetchedAt: previous.historyFetchedAt,
    });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("keeps validated partial posts and usable paging progress when history has a coverage warning", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      historyError: "Only accessible history is included.",
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(result.importedPostCount).toBe(1);
    expect(result.account.statistics).toMatchObject({
      historyNextCursor: "next-page",
      historyComplete: false,
      historyError: "Only accessible history is included.",
    });
    expect(result.account.statistics?.historyFetchedAt).not.toBe(
      previous.historyFetchedAt,
    );
    expect(mocks.upsert).toHaveBeenCalled();
  });
  it("completes enumerated history despite unavailable per-post insights", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      nextCursor: null,
      metricWarning: "Some post insights are unavailable.",
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(result.account.statistics).toMatchObject({
      historyNextCursor: null,
      historyComplete: true,
      historyError: null,
      metricWarning: "Some post insights are unavailable.",
    });
    expect(result.importedPostCount).toBe(1);
    expect(mocks.upsert).toHaveBeenCalled();
  });
  it("retains stored post metrics and their age when insights fail", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        {
          ...providerPost,
          metrics: { ...metrics, impressions: null },
          additionalMetrics: [],
        },
      ],
      metricWarning: "Video details are unavailable.",
    });
    await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    const { create, update } = mocks.upsert.mock.calls[0][0];
    expect(create.metrics.impressions).toBeNull();
    expect(update).toEqual({
      text: providerPost.text,
      contentType: "unknown",
      postKind: "unknown",
      media: [],
      publishedAt: new Date(providerPost.publishedAt),
      url: providerPost.url,
    });
    expect(update).not.toHaveProperty("metrics");
    expect(update).not.toHaveProperty("additionalMetrics");
    expect(update).not.toHaveProperty("fetchedAt");
  });
  it("retains account metrics and their age when optional analytics fail", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      accountMetrics: [{ ...metric, value: 123 }],
      accountError: "Channel analytics are unavailable.",
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(result.account.statistics).toMatchObject({
      metrics: previous.metrics,
      fetchedAt: previous.fetchedAt,
      error: "Channel analytics are unavailable.",
    });
  });
  it("retains an earlier metric warning across continuation pages", async () => {
    mocks.connections.mockResolvedValue([
      {
        ...connection,
        statistics: {
          ...previous,
          metricWarning: "Some previous post insights are unavailable.",
        },
      },
    ]);
    mocks.provider.mockResolvedValue({
      ...page,
      accountMetrics: null,
      nextCursor: null,
      metricWarning: null,
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
      continueHistory: true,
    });
    expect(result.account.statistics).toMatchObject({
      historyComplete: true,
      metricWarning: "Some previous post insights are unavailable.",
    });
  });
  it("keeps all account overviews while filtering the provider history", async () => {
    const otherId = "55555555-5555-4555-8555-555555555555";
    mocks.listAccounts.mockResolvedValue([
      account,
      { ...account, id: otherId, provider: "youtube" },
    ]);
    mocks.connections.mockResolvedValue([
      connection,
      { ...connection, id: otherId, provider: "youtube" },
    ]);
    const result = await listSocialAccountStatistics({
      ...scope,
      provider: "x",
      connectionId,
    });
    expect(result.accounts.map((item) => item.id)).toEqual([
      connectionId,
      otherId,
    ]);
    expect(mocks.posts.mock.calls[0][0].where.connectionId).toEqual({
      in: [connectionId],
    });
  });
  it("preserves old results when the provider fails and never stores its raw error", async () => {
    mocks.provider.mockRejectedValue(new Error("access_token=secret"));
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(result.account.statistics).toMatchObject({
      metrics: previous.metrics,
      fetchedAt: previous.fetchedAt,
      historyFetchedAt: previous.historyFetchedAt,
      historyComplete: false,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.account.statistics?.historyError).toBeTruthy();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects malformed counters before importing a provider page", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        {
          ...providerPost,
          metrics: { ...metrics, likes: Number.MAX_SAFE_INTEGER + 1 },
        },
      ],
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(result.account.statistics?.fetchedAt).toBe(previous.fetchedAt);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("fences simultaneous refreshes before any post upserts", async () => {
    mocks.update.mockResolvedValue({ count: 0 });
    await expect(
      refreshSocialAccountStatistics({
        ...scope,
        connectionId,
        userId: "reader",
      }),
    ).rejects.toThrow("changed during refresh");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("compares the original raw cache for CAS and handles missing cache as database null", async () => {
    mocks.connections.mockResolvedValue([{ ...connection, statistics: null }]);
    await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(mocks.update.mock.calls[0][0].where.statistics.equals).toBe(
      Prisma.DbNull,
    );
  });
  it("deduplicates imported identities and retains previously cached older posts on a restart", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [providerPost, providerPost],
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(result.importedPostCount).toBe(1);
    expect(result.account.postCount).toBe(41);
    expect(
      mocks.upsert.mock.calls.every(
        ([call]) =>
          call.where.connectionId_externalId.externalId ===
          providerPost.externalId,
      ),
    ).toBe(true);
  });
});

describe("completed archive daily head refresh", () => {
  const complete = {
    ...previous,
    historyComplete: true,
    historyNextCursor: null,
  };
  const input = { ...scope, connectionId, userId: "sync", refreshHead: true };
  beforeEach(() => {
    mocks.connections.mockResolvedValue([
      { ...connection, statistics: complete },
    ]);
  });
  it("retains complete coverage when a successful daily head reaches a cached post before its next cursor", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [{ ...providerPost, externalId: "new-head-post" }, providerPost],
    });
    const result = await refreshSocialAccountStatistics(input);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null }),
    );
    expect(result.account.statistics).toMatchObject({
      historyComplete: true,
      historyNextCursor: null,
      historyError: null,
    });
    expect(mocks.update.mock.calls[0][0].data.statistics).toMatchObject({
      historyComplete: true,
      historyNextCursor: null,
    });
    expect(mocks.posts).toHaveBeenCalledWith({
      where: {
        connectionId,
        externalId: { in: ["new-head-post", providerPost.externalId] },
      },
      select: { externalId: true, additionalMetrics: true, fetchedAt: true },
    });
    expect(mocks.posts.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.update.mock.invocationCallOrder[0],
    );
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
    expect(result.importedPostCount).toBe(2);
  });
  it("keeps a genuine new gap open when the full head has no cached identities and resumes it", async () => {
    const newPosts = Array.from({ length: 100 }, (_, index) => ({
      ...providerPost,
      externalId: `new-${index}`,
    }));
    mocks.posts.mockResolvedValue([]);
    mocks.provider.mockResolvedValueOnce({
      ...page,
      posts: newPosts,
      nextCursor: "new-gap-page-2",
    });
    const head = await refreshSocialAccountStatistics(input);
    expect(head.account.statistics).toMatchObject({
      historyComplete: false,
      historyNextCursor: "new-gap-page-2",
      historyError: null,
    });
    expect(head.importedPostCount).toBe(100);
    mocks.connections.mockResolvedValue([
      { ...connection, statistics: head.account.statistics },
    ]);
    mocks.provider.mockResolvedValueOnce({
      ...page,
      accountMetrics: null,
      nextCursor: null,
    });
    const continuation = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "sync",
      continueHistory: true,
    });
    expect(mocks.provider).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: "new-gap-page-2",
        includeProfile: false,
      }),
    );
    expect(continuation.account.statistics).toMatchObject({
      historyComplete: true,
      historyNextCursor: null,
    });
  });
  it("does not treat a partially returned failed head as proof of complete coverage", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      historyError: "History temporarily unavailable",
    });
    const result = await refreshSocialAccountStatistics(input);
    expect(result.account.statistics).toMatchObject({
      historyComplete: false,
      historyNextCursor: "next-page",
      historyError: "History temporarily unavailable",
    });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty(
      "performanceHeadFetchedAt",
    );
  });
  it("retains cache and marks coverage incomplete when the daily provider read throws", async () => {
    mocks.provider.mockRejectedValue(new Error("Provider unavailable"));
    const result = await refreshSocialAccountStatistics(input);
    expect(result.account.statistics).toMatchObject({
      historyComplete: false,
      historyNextCursor: null,
      metrics: previous.metrics,
    });
    expect(result.account.statistics?.historyError).not.toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty(
      "performanceHeadFetchedAt",
    );
  });
  it("completes an exhausted successful head without requiring cached overlap", async () => {
    mocks.posts.mockResolvedValue([]);
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [{ ...providerPost, externalId: "new-only-post" }],
      nextCursor: null,
    });
    const result = await refreshSocialAccountStatistics(input);
    expect(result.account.statistics).toMatchObject({
      historyComplete: true,
      historyNextCursor: null,
      historyError: null,
    });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
  });
  it("checks the same overlap for other providers without preserving X private metric keys on them", async () => {
    mocks.listAccounts.mockResolvedValue([
      { ...account, provider: "facebook" },
    ]);
    mocks.connections.mockResolvedValue([
      { ...connection, provider: "facebook", statistics: complete },
    ]);
    mocks.posts.mockResolvedValue([
      {
        ...cachedPost,
        additionalMetrics: [
          { key: "engagements", value: 999, period: "lifetime", unit: "count" },
        ],
      },
    ]);
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        {
          ...providerPost,
          additionalMetrics: [
            {
              key: "engagements",
              value: null,
              period: "lifetime",
              unit: "count",
            },
          ],
        },
      ],
    });
    const result = await refreshSocialAccountStatistics(input);
    expect(result.account.statistics).toMatchObject({
      historyComplete: true,
      historyNextCursor: null,
    });
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ connectionId }),
      }),
    );
    expect(mocks.upsert.mock.calls[0][0].update.additionalMetrics).toEqual([
      { key: "engagements", value: null, period: "lifetime", unit: "count" },
    ]);
  });
  it("keeps explicit manual archive restarts unchanged even when cached identities overlap", async () => {
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(result.account.statistics).toMatchObject({
      historyComplete: false,
      historyNextCursor: "next-page",
    });
  });
});

describe("daily head gaps during ongoing archive import", () => {
  const input = {
    ...scope,
    connectionId,
    userId: "sync",
    continueHistory: true,
    refreshHead: true,
  };
  const newPosts = Array.from({ length: 100 }, (_, index) => ({
    ...providerPost,
    externalId: `fresh-head-${index}`,
  }));
  it.each([null, "archive-page-3"])(
    "prioritizes an uncovered head gap even when the old continuation cursor is %s",
    async (archiveCursor) => {
      // The old continuation contains a cached identity. It must not count as head overlap.
      mocks.posts.mockResolvedValue([cachedPost]);
      mocks.provider
        .mockResolvedValueOnce({ ...page, nextCursor: archiveCursor })
        .mockResolvedValueOnce({
          ...page,
          accountMetrics: null,
          posts: newPosts,
          nextCursor: "fresh-gap-page-2",
        });
      const head = await refreshSocialAccountStatistics(input);
      expect(head.account.statistics).toMatchObject({
        historyComplete: false,
        historyNextCursor: "fresh-gap-page-2",
        historyError: null,
      });
      expect(mocks.update.mock.calls[0][0].data.statistics).toMatchObject({
        historyComplete: false,
        historyNextCursor: "fresh-gap-page-2",
      });
      expect(mocks.posts).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            connectionId,
            externalId: {
              in: [
                providerPost.externalId,
                ...newPosts.map((post) => post.externalId),
              ],
            },
          },
        }),
      );
      expect(mocks.posts.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.upsert.mock.invocationCallOrder[0],
      );
      expect(head.importedPostCount).toBe(101);
      expect(mocks.upsert).toHaveBeenCalledTimes(101);
      mocks.connections.mockResolvedValue([
        { ...connection, statistics: head.account.statistics },
      ]);
      mocks.provider.mockResolvedValueOnce({
        ...page,
        accountMetrics: null,
        nextCursor: "fresh-gap-page-3",
      });
      const next = await refreshSocialAccountStatistics({
        ...scope,
        connectionId,
        userId: "sync",
        continueHistory: true,
      });
      expect(mocks.provider).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          cursor: "fresh-gap-page-2",
          includeProfile: false,
        }),
      );
      // Meeting retained posts on this continuation cannot close a previously incomplete archive.
      expect(next.account.statistics).toMatchObject({
        historyComplete: false,
        historyNextCursor: "fresh-gap-page-3",
      });
    },
  );
  it.each([null, "archive-page-3"])(
    "preserves old continuation progress %s when the head overlaps cached history",
    async (archiveCursor) => {
      mocks.provider
        .mockResolvedValueOnce({ ...page, nextCursor: archiveCursor })
        .mockResolvedValueOnce({
          ...page,
          accountMetrics: null,
          posts: [...newPosts, providerPost],
          nextCursor: "head-page-2",
        });
      const result = await refreshSocialAccountStatistics(input);
      expect(result.account.statistics).toMatchObject({
        historyComplete: archiveCursor === null,
        historyNextCursor: archiveCursor,
        historyError: null,
      });
    },
  );
  it("preserves old continuation progress when a successful daily head is exhausted", async () => {
    mocks.provider
      .mockResolvedValueOnce({ ...page, nextCursor: "archive-page-3" })
      .mockResolvedValueOnce({
        ...page,
        accountMetrics: null,
        posts: newPosts,
        nextCursor: null,
      });
    const result = await refreshSocialAccountStatistics(input);
    expect(result.account.statistics).toMatchObject({
      historyComplete: false,
      historyNextCursor: "archive-page-3",
      historyError: null,
    });
  });
  it("never prioritizes a cursor from a failed daily head even if it contains new posts", async () => {
    mocks.provider
      .mockResolvedValueOnce({ ...page, nextCursor: "archive-page-3" })
      .mockResolvedValueOnce({
        ...page,
        accountMetrics: null,
        posts: newPosts,
        nextCursor: "failed-head-page-2",
        historyError: "Head partially unavailable",
      });
    const result = await refreshSocialAccountStatistics(input);
    expect(result.account.statistics).toMatchObject({
      historyComplete: false,
      historyNextCursor: "archive-page-3",
      historyError: null,
      metricWarning: "Head partially unavailable",
    });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty(
      "performanceHeadFetchedAt",
    );
  });
  it("prioritizes the head gap for non-X providers using the same scoped pre-upsert identities", async () => {
    mocks.listAccounts.mockResolvedValue([
      { ...account, provider: "facebook" },
    ]);
    mocks.connections.mockResolvedValue([
      { ...connection, provider: "facebook" },
    ]);
    mocks.provider
      .mockResolvedValueOnce({ ...page, nextCursor: null })
      .mockResolvedValueOnce({
        ...page,
        accountMetrics: null,
        posts: newPosts,
        nextCursor: "newer-gap-page-2",
      });
    const result = await refreshSocialAccountStatistics(input);
    expect(result.account.statistics).toMatchObject({
      historyComplete: false,
      historyNextCursor: "newer-gap-page-2",
    });
  });
});
