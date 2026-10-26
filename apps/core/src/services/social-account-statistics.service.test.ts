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
  storedPosts: vi.fn(),
  cursor: vi.fn(),
  transaction: vi.fn(),
  snapshot: vi.fn(),
  published: vi.fn(),
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
vi.mock(
  "@/services/project-social-connections.service",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/services/project-social-connections.service")
    >()),
    listProjectSocialConnections: mocks.listAccounts,
  }),
);
vi.mock("@/clients/social-post-providers/account-statistics", () => ({
  fetchSocialAccountStatisticsPage: mocks.provider,
}));
vi.mock("@/services/social-performance-snapshots.service", () => ({
  recordSocialPerformanceSnapshot: mocks.snapshot,
}));

import {
  exportSocialAccountStatistics,
  listSocialAccountStatistics,
  listSuggestedPostingTimes,
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
  mocks.published.mockResolvedValue({ count: 0 });
  mocks.storedPosts.mockResolvedValue([]);
  mocks.transaction.mockImplementation(async (operation) =>
    operation({
      projectSocialConnection: { updateMany: mocks.update },
      socialAccountPost: {
        findMany: mocks.storedPosts,
        upsert: mocks.upsert,
        count: mocks.count,
      },
      socialPost: { updateMany: mocks.published },
    }),
  );
});

describe("Social account statistics", () => {
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
    expect(result.headline.current).toEqual({
      postCount: 1,
      views: null,
      impressions: 100,
      interactions: null,
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
    expect(result.consistency.daily[0]).toMatchObject({
      date: "2026-10-01",
      postCount: 1,
    });
  });
  it("exports every matching cached post without paging", async () => {
    const publishedFrom = new Date("2026-10-01T00:00:00Z");
    const result = await exportSocialAccountStatistics({
      ...scope,
      connectionId,
      publishedFrom,
    });
    expect(result.posts).toHaveLength(1);
    expect(result.accountName(connectionId)).toBe("Launch");
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId: { in: [connectionId] },
          publishedAt: { gte: publishedFrom },
        },
      }),
    );
    expect(mocks.posts.mock.calls[0][0].take).toBeUndefined();
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
  it("lists every connected account in the workspace when no project is selected", async () => {
    const result = await listSocialAccountStatistics({ workspaceId });
    expect(mocks.listAccounts).not.toHaveBeenCalled();
    expect(mocks.connections).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          project: { workspaceId },
          status: { not: "disconnected" },
        },
      }),
    );
    expect(result.accounts[0]).toMatchObject({
      id: connectionId,
      postCount: 40,
    });
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
      executorUserId: `sokosumi:project-executor:${projectId}`,
      externalAccountId: "external-account",
      externalHandle: "launch",
      cursor: null,
      includeProfile: true,
    });
    expect(result.account.statistics?.metrics).toEqual([metric]);
    expect(result.account.statistics?.historyComplete).toBe(false);
    expect(result.account.postCount).toBe(41);
    expect(result.importedPostCount).toBe(1);
    expect(mocks.snapshot).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        connectionId,
        metrics: [metric],
      }),
    );
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
          contentType: "unknown",
          postKind: "unknown",
          media: [],
          metrics,
          additionalMetrics: providerPost.additionalMetrics,
          fetchedAt: expect.any(Date),
        }),
        update: expect.objectContaining({
          metrics,
          fetchedAt: expect.any(Date),
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
  it("copies measured counters onto the matching published Sokosumi post", async () => {
    await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(mocks.published).toHaveBeenCalledWith({
      where: {
        projectId,
        workspaceId,
        socialConnectionId: connectionId,
        status: "PUBLISHED",
        publishedExternalId: providerPost.externalId,
      },
      data: {
        statistics: {
          metrics,
          fetchedAt: expect.any(String),
          refreshAttemptedAt: expect.any(String),
          error: null,
        },
      },
    });
  });
  it("stores imported media while retaining counters a partial fetch did not measure", async () => {
    const media = [
      {
        kind: "video",
        url: "https://media.example.com/post.mp4",
        thumbnailUrl: "https://media.example.com/thumbnail.jpg",
      },
    ];
    mocks.storedPosts.mockResolvedValue([
      {
        externalId: providerPost.externalId,
        metrics: { ...metrics, likes: 7 },
        additionalMetrics: [],
      },
    ]);
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        {
          ...providerPost,
          contentType: "video",
          postKind: "quote",
          media,
          metrics: { ...metrics, impressions: 0, likes: null },
        },
      ],
    });
    await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    const { create, update } = mocks.upsert.mock.calls[0][0];
    for (const data of [create, update]) {
      expect(data).toMatchObject({
        contentType: "video",
        postKind: "quote",
        media,
        metrics: { impressions: 0, likes: 7 },
      });
    }
    expect(mocks.published).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          statistics: expect.objectContaining({
            metrics: { ...metrics, impressions: 0, likes: 7 },
          }),
        },
      }),
    );
    mocks.posts.mockResolvedValue([
      { ...cachedPost, contentType: "video", postKind: "quote", media },
    ]);
    const result = await listSocialAccountStatistics(scope);
    expect(result.posts[0]).toMatchObject({
      contentType: "video",
      postKind: "quote",
      media,
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
  it("retains stored post metrics and their age when that post has no measured counters", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        {
          ...providerPost,
          metrics: {
            views: null,
            impressions: null,
            likes: null,
            comments: null,
            shares: null,
            saves: null,
          },
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
    expect(mocks.published).not.toHaveBeenCalled();
  });
  it("keeps stored likes when a later sync only measures impressions", async () => {
    mocks.storedPosts.mockResolvedValue([
      {
        externalId: providerPost.externalId,
        metrics: {
          views: null,
          impressions: 40,
          likes: 5,
          comments: 2,
          shares: null,
          saves: null,
        },
        additionalMetrics: [
          { key: "quotes", value: 3, period: "lifetime", unit: "count" },
          { key: "bookmarks", value: 1, period: "lifetime", unit: "count" },
        ],
      },
    ]);
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        {
          ...providerPost,
          metrics: {
            views: null,
            impressions: 100,
            likes: null,
            comments: null,
            shares: null,
            saves: null,
          },
          additionalMetrics: [
            { key: "quotes", value: null, period: "lifetime", unit: "count" },
          ],
        },
      ],
    });
    await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(mocks.storedPosts).toHaveBeenCalledWith({
      where: {
        connectionId,
        externalId: { in: [providerPost.externalId] },
      },
      select: {
        externalId: true,
        metrics: true,
        additionalMetrics: true,
      },
    });
    const { update } = mocks.upsert.mock.calls[0][0];
    expect(update.metrics).toEqual({
      views: null,
      impressions: 100,
      likes: 5,
      comments: 2,
      shares: null,
      saves: null,
    });
    expect(update.additionalMetrics).toEqual([
      { key: "quotes", value: 3, period: "lifetime", unit: "count" },
      { key: "bookmarks", value: 1, period: "lifetime", unit: "count" },
    ]);
    expect(mocks.published).toHaveBeenCalledWith({
      where: {
        projectId,
        workspaceId,
        socialConnectionId: connectionId,
        status: "PUBLISHED",
        publishedExternalId: providerPost.externalId,
      },
      data: {
        statistics: {
          metrics: update.metrics,
          fetchedAt: update.fetchedAt.toISOString(),
          refreshAttemptedAt: expect.any(String),
          error: null,
        },
      },
    });
  });
  it("writes a measured zero over a stored like count", async () => {
    mocks.storedPosts.mockResolvedValue([
      {
        externalId: providerPost.externalId,
        metrics: {
          views: null,
          impressions: 40,
          likes: 5,
          comments: null,
          shares: null,
          saves: null,
        },
        additionalMetrics: [],
      },
    ]);
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        {
          ...providerPost,
          metrics: {
            views: null,
            impressions: 40,
            likes: 0,
            comments: null,
            shares: null,
            saves: null,
          },
          additionalMetrics: [],
        },
      ],
    });
    await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    expect(mocks.upsert.mock.calls[0][0].update.metrics.likes).toBe(0);
  });
  it("still writes measured posts when a sibling insight fails", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      posts: [
        providerPost,
        {
          ...providerPost,
          externalId: "failed-insight",
          metrics: {
            views: null,
            impressions: null,
            likes: null,
            comments: null,
            shares: null,
            saves: null,
          },
        },
      ],
      metricWarning: "Some post insights are unavailable.",
    });
    await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
    });
    const measured = mocks.upsert.mock.calls.find(
      ([call]) =>
        call.where.connectionId_externalId.externalId ===
        providerPost.externalId,
    )?.[0];
    const failed = mocks.upsert.mock.calls.find(
      ([call]) =>
        call.where.connectionId_externalId.externalId === "failed-insight",
    )?.[0];
    expect(measured?.update).toMatchObject({ metrics });
    expect(failed?.update).not.toHaveProperty("metrics");
    expect(mocks.snapshot).toHaveBeenCalled();
    expect(mocks.published).toHaveBeenCalledTimes(1);
    expect(mocks.published).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          publishedExternalId: providerPost.externalId,
        }),
      }),
    );
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
  it("refreshes the latest page without restarting a stored archive cursor", async () => {
    mocks.provider.mockResolvedValue({
      ...page,
      nextCursor: "latest-next",
    });
    const result = await refreshSocialAccountStatistics({
      ...scope,
      connectionId,
      userId: "reader",
      refreshHead: true,
    });
    expect(mocks.provider).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: null,
        includeProfile: true,
      }),
    );
    expect(result.account.statistics).toMatchObject({
      historyNextCursor: previous.historyNextCursor,
      historyComplete: false,
      consecutiveFailures: 0,
    });
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({
      performanceHeadFetchedAt: expect.any(Date),
    });
  });
  it("attaches a cache-only sync model on reads", async () => {
    const result = await listSocialAccountStatistics({
      ...scope,
      connectionId,
    });
    expect(result.accounts[0]?.sync).toMatchObject({
      status: expect.stringMatching(
        /fresh|stale|queued|running|reauth_required|partial/,
      ),
    });
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});

describe("listSuggestedPostingTimes", () => {
  const scoredMetrics = {
    views: null,
    impressions: 100,
    likes: 10,
    comments: 0,
    shares: 0,
    saves: null,
  };

  function scoredPost(publishedAt: string, likes: number) {
    return {
      publishedAt: new Date(publishedAt),
      metrics: { ...scoredMetrics, likes },
      additionalMetrics: [
        { key: "quote_count", value: 0, period: "lifetime", unit: "count" },
      ],
      connection: { provider: "x" },
    };
  }

  it("rejects an account outside the authorized Project", async () => {
    await expect(
      listSuggestedPostingTimes({
        ...scope,
        connectionId: postId,
        timezone: "UTC",
      }),
    ).rejects.toThrow("connection not found");
    expect(mocks.posts).not.toHaveBeenCalled();
  });

  it("returns ranked hours from cached Performance posts", async () => {
    mocks.posts.mockResolvedValue([
      scoredPost("2026-09-01T13:00:00Z", 10),
      scoredPost("2026-09-02T13:00:00Z", 10),
      scoredPost("2026-09-03T13:00:00Z", 10),
      scoredPost("2026-09-04T13:00:00Z", 10),
      scoredPost("2026-09-01T18:00:00Z", 4),
      scoredPost("2026-09-02T18:00:00Z", 4),
      scoredPost("2026-09-03T18:00:00Z", 4),
      scoredPost("2026-09-04T18:00:00Z", 4),
    ]);
    await expect(
      listSuggestedPostingTimes({
        ...scope,
        connectionId,
        timezone: "UTC",
        now: new Date("2026-10-01T12:00:00Z"),
      }),
    ).resolves.toEqual({ hours: [13, 18] });
    expect(mocks.posts).toHaveBeenCalledWith({
      where: {
        connectionId,
        publishedAt: { gte: new Date("2026-07-03T12:00:00.000Z") },
      },
      select: {
        publishedAt: true,
        metrics: true,
        additionalMetrics: true,
        connection: { select: { provider: true } },
      },
    });
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
