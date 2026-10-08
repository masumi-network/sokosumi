import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  socialAccountPostSchema,
  socialAccountStatisticsAccountSchema,
} from "@/schemas/social-account-statistics.schema";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  projects: vi.fn(),
  posts: vi.fn(),
  snapshots: vi.fn(),
  count: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findMany: mocks.projects },
    socialAccountPost: { findMany: mocks.posts, count: mocks.count },
    socialPerformanceSnapshot: { findMany: mocks.snapshots },
  },
}));
vi.mock("@/services/social-account-statistics.service", () => ({
  listSocialAccountStatistics: mocks.accounts,
}));

import {
  buildSocialPerformance,
  listSocialPerformance,
  listWorkspaceSocialPerformance,
} from "./social-performance.service";

const projectId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const secondConnectionId = "55555555-5555-4555-8555-555555555555";
const account = socialAccountStatisticsAccountSchema.parse({
  id: connectionId,
  provider: "x",
  externalHandle: "launch",
  displayName: "Launch",
  avatarUrl: null,
  status: "active",
  connectedAt: null,
  disconnectedAt: null,
  postCount: 105,
  statistics: {
    metrics: [],
    fetchedAt: "2026-10-07T12:00:00Z",
    refreshAttemptedAt: null,
    error: null,
    historyNextCursor: null,
    historyComplete: true,
    historyFetchedAt: "2026-10-07T12:00:00Z",
    historyError: null,
  },
});
const query = {
  publishedFrom: "2026-10-01T00:00:00.000Z",
  publishedUntil: "2026-10-07T23:59:59.999Z",
};
function post(
  index = 1,
  overrides: Partial<ReturnType<typeof socialAccountPostSchema.parse>> = {},
) {
  return socialAccountPostSchema.parse({
    id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    connectionId,
    provider: "x",
    externalId: `post-${index}`,
    text: "Launch post",
    contentType: "text",
    postKind: "post",
    publishedAt: "2026-10-01T12:00:00Z",
    url: "https://x.com/launch/status/123",
    media: [],
    metrics: {
      views: null,
      impressions: 100,
      likes: 10,
      comments: 2,
      shares: 3,
      saves: 99,
    },
    additionalMetrics: [
      { key: "quote_count", value: 1, period: "lifetime", unit: "count" },
    ],
    fetchedAt: "2026-10-07T12:00:00Z",
    ...overrides,
  });
}
function build(
  posts: ReturnType<typeof post>[],
  overrides: Partial<Parameters<typeof buildSocialPerformance>[0]> = {},
) {
  return buildSocialPerformance({
    accounts: [account],
    posts,
    snapshots: [],
    query,
    ...overrides,
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.accounts.mockResolvedValue({
    accounts: [account],
    posts: [],
    nextCursor: null,
  });
  mocks.projects.mockResolvedValue([{ id: projectId, name: "Launch" }]);
  mocks.posts.mockResolvedValue([{ ...post(), connection: { provider: "x" } }]);
  mocks.snapshots.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
});

describe("social performance aggregation", () => {
  it("aggregates the whole cohort before returning the ranked top 100 and supports complete exports", () => {
    const posts = Array.from({ length: 105 }, (_, index) => post(index + 1));
    const result = build(posts);
    expect(result.summary.current.postCount).toBe(105);
    expect(result.summary.current.metrics.impressions).toEqual({
      total: 10500,
      mean: 100,
      median: 100,
      measuredPostCount: 105,
    });
    expect(result.summary.current.interactions.total).toBe(1680);
    expect(result.posts).toHaveLength(100);
    expect(result.pagination).toEqual({
      limit: 100,
      offset: 0,
      nextOffset: 100,
      total: 105,
      truncated: true,
    });
    expect(build(posts, { includeAllPosts: true }).posts).toHaveLength(105);
    const next = build(posts, { query: { ...query, offset: 100 } });
    expect(next.posts).toHaveLength(5);
    expect(next.pagination.nextOffset).toBeNull();
    expect(next.summary.current.postCount).toBe(105);
  });
  it("reports means and medians without converting missing counters to zero", () => {
    const posts = [0, 1, 100, null].map((likes, index) =>
      post(index + 1, {
        metrics: {
          views: null,
          impressions: 100,
          likes,
          comments: 0,
          shares: 0,
          saves: null,
        },
      }),
    );
    const summary = build(posts).summary.current;
    expect(summary.metrics.likes).toEqual({
      total: 101,
      mean: 101 / 3,
      median: 1,
      measuredPostCount: 3,
    });
    expect(summary.metrics.views).toEqual({
      total: null,
      mean: null,
      median: null,
      measuredPostCount: 0,
    });
    expect(summary.interactions.measuredPostCount).toBe(3);
  });
  it("uses X's received likes, replies, reposts and quotes, excludes saves, and requires a known complete numerator", () => {
    const result = build([
      post(1),
      post(2, { additionalMetrics: [] }),
      post(3, { metrics: { ...post().metrics, comments: null } }),
      post(4, { metrics: { ...post().metrics, impressions: 0 } }),
      post(5, {
        metrics: { ...post().metrics, likes: 0, comments: 0, shares: 0 },
        additionalMetrics: [
          { key: "quote_count", value: 0, period: "lifetime", unit: "count" },
        ],
      }),
    ]);
    expect(
      result.posts.find((row) => row.externalId === "post-1"),
    ).toMatchObject({
      interactions: 16,
      engagementRate: 16,
      engagementDenominator: "impressions",
    });
    expect(
      result.posts.find((row) => row.externalId === "post-2"),
    ).toMatchObject({ interactions: null, engagementRate: null });
    expect(
      result.posts.find((row) => row.externalId === "post-3"),
    ).toMatchObject({ interactions: null, engagementRate: null });
    expect(
      result.posts.find((row) => row.externalId === "post-4"),
    ).toMatchObject({ interactions: 16, engagementRate: null });
    expect(
      result.posts.find((row) => row.externalId === "post-5"),
    ).toMatchObject({ interactions: 0, engagementRate: 0 });
    expect(result.summary.current.engagementRates[0]).toMatchObject({
      measuredPostCount: 2,
      interactions: 16,
      exposure: 200,
      rate: 8,
    });
  });
  it("separates provider denominators and does not manufacture a blended engagement rate", () => {
    const youtube = {
      ...account,
      id: secondConnectionId,
      provider: "youtube" as const,
    };
    const result = build(
      [
        post(),
        post(2, {
          connectionId: secondConnectionId,
          provider: "youtube",
          metrics: {
            views: 1000,
            impressions: null,
            likes: 10,
            comments: 2,
            shares: 3,
            saves: null,
          },
        }),
      ],
      { accounts: [account, youtube] },
    );
    expect(result.summary.current.engagementRates).toEqual([
      expect.objectContaining({
        provider: "x",
        denominator: "impressions",
        rate: 16,
      }),
      expect.objectContaining({
        provider: "youtube",
        denominator: "views",
        rate: 1.5,
      }),
    ]);
    expect(result.heatmap.comparisonProvider).toBeNull();
    expect(
      result.heatmap.cells.find((cell) => cell.postCount > 0),
    ).toMatchObject({ meanInteractions: null, meanEngagementRate: null });
  });
  it("compares adjacent equal-duration publication cohorts and suppresses deltas when metric coverage differs", () => {
    const past = post(2, {
      publishedAt: "2026-09-30T23:59:59.999Z",
      metrics: { ...post().metrics, impressions: 50 },
    });
    const excluded = post(3, { publishedAt: "2026-09-23T23:59:59.999Z" });
    const result = build([post(), past, excluded]);
    expect(result.range).toMatchObject({
      previousFrom: "2026-09-24T00:00:00.000Z",
      previousUntil: "2026-09-30T23:59:59.999Z",
      semantics: "lifetime_metrics_by_publication_cohort",
    });
    expect(result.summary.previous.postCount).toBe(1);
    expect(result.summary.deltas.impressions).toBe(50);
    expect(result.summary.deltas.views).toBeNull();
    expect(
      build([
        post(),
        post(2, { ...past, metrics: { ...past.metrics, impressions: null } }),
      ]).summary.deltas.impressions,
    ).toBeNull();
  });
  it("applies post-kind/search/format filters to the whole cohort and identifies unknown legacy classification", () => {
    const posts = [
      post(),
      post(2, { postKind: "reply" }),
      post(3, { postKind: "repost" }),
      post(4, { postKind: "unknown", contentType: "unknown" }),
      post(5, { contentType: "image", text: "Photo" }),
    ];
    const result = build(posts);
    expect(result.summary.current.postCount).toBe(3);
    expect(result.coverage).toMatchObject({
      unknownPostKindCount: 1,
      unknownContentTypeCount: 1,
    });
    expect(
      build(posts, {
        query: { ...query, search: "photo", contentType: "image" },
      }).summary.current.postCount,
    ).toBe(1);
    expect(
      build(posts, { query: { ...query, postKind: "replies" } }).posts.map(
        (row) => row.externalId,
      ),
    ).toEqual(["post-2"]);
  });
  it("places publications in the selected timezone including Monday-based weekday and local date", () => {
    const result = build([post(1, { publishedAt: "2026-10-04T23:30:00Z" })], {
      query: { ...query, timezone: "Europe/Prague" },
    });
    expect(
      result.daily.find((day) => day.date === "2026-10-05")?.summary.postCount,
    ).toBe(1);
    expect(
      result.heatmap.cells.find(
        (cell) => cell.weekday === 0 && cell.hour === 1,
      ),
    ).toMatchObject({
      postCount: 1,
      measuredPostCount: 1,
      meanInteractions: 16,
    });
    expect(result.heatmap.cells).toHaveLength(168);
    expect(result.heatmap.minimumSampleSize).toBe(10);
  });
  it("requires ten measured earlier posts for an account-specific median multiplier", () => {
    const baseline = Array.from({ length: 10 }, (_, index) =>
      post(index + 2, { publishedAt: "2026-09-20T12:00:00Z" }),
    );
    const result = build([post(), ...baseline]);
    expect(result.posts[0]).toMatchObject({
      baselineSampleSize: 10,
      baselineMultiplier: 1,
    });
    expect(
      build([post(), ...baseline.slice(1)]).posts[0].baselineMultiplier,
    ).toBeNull();
  });
  it("excludes each target from its own baseline without losing zero-valued or duplicate measurements", () => {
    const baseline = Array.from({ length: 12 }, (_, index) =>
      post(index + 2, {
        publishedAt: "2026-09-20T12:00:00Z",
        metrics: { ...post().metrics, likes: index, comments: 0, shares: 0 },
        additionalMetrics: [
          { key: "quote_count", value: 0, period: "lifetime", unit: "count" },
        ],
      }),
    );
    const target = post(1, {
      metrics: { ...post().metrics, likes: 5, comments: 0, shares: 0 },
      additionalMetrics: [
        { key: "quote_count", value: 0, period: "lifetime", unit: "count" },
      ],
    });
    expect(build([target, ...baseline]).posts[0]).toMatchObject({
      baselineSampleSize: 12,
      baselineMultiplier: 5 / 5.5,
    });
  });
  it("groups lifetime metrics with retained measurement timestamps and avoids adding averages or percentages", () => {
    const posts = [
      post(1, {
        additionalMetrics: [
          {
            key: "url_link_clicks",
            value: 2,
            period: "lifetime:2026-10-01T12:00:00Z",
            unit: "count",
          },
          {
            key: "ig_reels_avg_watch_time",
            value: 10,
            period: "lifetime",
            unit: "milliseconds",
          },
          {
            key: "reels_skip_rate",
            value: 20,
            period: "lifetime",
            unit: "percent",
          },
        ],
      }),
      post(2, {
        additionalMetrics: [
          {
            key: "url_link_clicks",
            value: 4,
            period: "lifetime:2026-10-02T12:00:00Z",
            unit: "count",
          },
          {
            key: "ig_reels_avg_watch_time",
            value: 20,
            period: "lifetime",
            unit: "milliseconds",
          },
          {
            key: "reels_skip_rate",
            value: 40,
            period: "lifetime",
            unit: "percent",
          },
        ],
      }),
    ];
    const metrics = build(posts).summary.current.additionalMetrics;
    expect(
      metrics.find((metric) => metric.key === "url_link_clicks"),
    ).toMatchObject({
      period: "lifetime",
      aggregate: { total: 6, measuredPostCount: 2 },
    });
    expect(
      metrics.find((metric) => metric.key === "ig_reels_avg_watch_time"),
    ).toMatchObject({ aggregate: { total: null, mean: 15 } });
    expect(
      metrics.find((metric) => metric.key === "reels_skip_rate"),
    ).toMatchObject({ aggregate: { total: null, mean: 30 } });
  });
  it("uses only observed follower samples and cache snapshots, preserving zero and absent profile measurements", () => {
    const source = post();
    const snapshot = {
      connectionId,
      date: "2026-10-02T00:00:00Z",
      fetchedAt: "2026-10-02T12:00:00Z",
      profileFetchedAt: "2026-10-02T00:05:00Z",
      metrics: [
        { key: "followers", value: 0, period: "lifetime", unit: "count" },
      ],
      postMetrics: [
        {
          externalId: source.externalId,
          metrics: { ...source.metrics, impressions: 30 },
          additionalMetrics: source.additionalMetrics,
        },
      ],
    };
    const result = build([source], {
      snapshots: [
        snapshot,
        {
          ...snapshot,
          date: "2026-10-03T00:00:00Z",
          fetchedAt: "2026-10-03T12:00:00Z",
          profileFetchedAt: null,
          metrics: [],
          postMetrics: [],
        },
        {
          ...snapshot,
          date: "2026-10-04T00:00:00Z",
          fetchedAt: "2026-10-04T12:00:00Z",
          profileFetchedAt: "2026-10-04T00:05:00Z",
          metrics: [
            { key: "followers", value: 12, period: "lifetime", unit: "count" },
          ],
        },
      ],
    });
    expect(result.followers[0]).toMatchObject({
      change: 12,
      points: [
        { value: 0, fetchedAt: "2026-10-02T00:05:00Z" },
        { value: 12, fetchedAt: "2026-10-04T00:05:00Z" },
      ],
    });
    expect(result.observations[0].summary.metrics.impressions.total).toBe(30);
    expect(result.coverage.historicalSnapshotsAvailable).toBe(true);
    const morning = build([source], {
      query: { ...query, publishedUntil: "2026-10-02T06:00:00Z" },
      snapshots: [snapshot],
    });
    expect(morning.followers[0].points).toEqual([
      expect.objectContaining({ value: 0, fetchedAt: "2026-10-02T00:05:00Z" }),
    ]);
    expect(morning.observations).toEqual([]);
    expect(build([source]).followers[0]).toMatchObject({
      change: null,
      points: [],
    });
  });
});

describe("social performance cache access", () => {
  it("authorizes the Project and workspace before querying complete matching cache records", async () => {
    const result = await listSocialPerformance({
      projectId,
      workspaceId,
      provider: "x",
      connectionId,
      ...query,
      limit: 1,
    });
    expect(mocks.accounts).toHaveBeenCalledWith({
      projectId,
      workspaceId,
      provider: "x",
      connectionId,
      limit: 1,
    });
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connectionId: { in: [connectionId] },
          connection: { projectId, project: { workspaceId } },
        }),
      }),
    );
    expect(mocks.posts.mock.calls[0][0]).not.toHaveProperty("take");
    expect(result.summary.current.postCount).toBe(1);
    expect(result.posts).toHaveLength(1);
  });
  it("does not read any raw cache when authorization fails", async () => {
    mocks.accounts.mockRejectedValue(new Error("Project not found"));
    await expect(
      listSocialPerformance({ projectId, workspaceId, ...query }),
    ).rejects.toThrow("Project not found");
    expect(mocks.posts).not.toHaveBeenCalled();
    expect(mocks.snapshots).not.toHaveBeenCalled();
  });
  it("rejects impossible or overlong date ranges before database reads", async () => {
    await expect(
      listSocialPerformance({
        projectId,
        workspaceId,
        publishedFrom: "2025-01-01T00:00:00Z",
        publishedUntil: "2026-10-08T00:00:00Z",
      }),
    ).rejects.toThrow("Publication range");
    expect(mocks.posts).not.toHaveBeenCalled();
  });
});

const secondProjectId = "66666666-6666-4666-8666-666666666666";
function workspaceProjects() {
  mocks.projects.mockResolvedValue([
    { id: projectId, name: "Launch" },
    { id: secondProjectId, name: "Growth" },
  ]);
  mocks.accounts.mockImplementation(
    ({ projectId: id }: { projectId: string }) =>
      Promise.resolve({
        accounts: [
          {
            ...account,
            id: id === projectId ? connectionId : secondConnectionId,
          },
        ],
        posts: [],
        nextCursor: null,
      }),
  );
}
function cachedPosts(posts: ReturnType<typeof post>[]) {
  mocks.posts.mockImplementation(
    ({ where }: { where: { connectionId: { in: string[] } } }) =>
      Promise.resolve(
        posts
          .filter((post) => where.connectionId.in.includes(post.connectionId))
          .map((post) => ({
            ...post,
            connection: { provider: post.provider },
          })),
      ),
  );
}

describe("workspace performance", () => {
  it("combines raw publication cohorts before aggregating medians, totals and pagination", async () => {
    workspaceProjects();
    const posts = [1, 1, 1, 100].map((likes, index) =>
      post(index + 1, {
        connectionId: index === 3 ? secondConnectionId : connectionId,
        metrics: {
          views: null,
          impressions: 100,
          likes,
          comments: 0,
          shares: 0,
          saves: null,
        },
      }),
    );
    cachedPosts(posts);
    const result = await listWorkspaceSocialPerformance({
      workspaceId,
      ...query,
      limit: 1,
    });
    expect(result.summary.current.metrics.likes).toEqual({
      total: 103,
      mean: 25.75,
      median: 1,
      measuredPostCount: 4,
    });
    expect(
      result.comparisons.projects.map(
        (item) => item.summary.metrics.likes.median,
      ),
    ).toEqual([1, 100]);
    expect(result.posts).toHaveLength(1);
    expect(result.pagination.total).toBe(4);
    expect(result.projects).toEqual([
      { id: projectId, name: "Launch", connectionIds: [connectionId] },
      {
        id: secondProjectId,
        name: "Growth",
        connectionIds: [secondConnectionId],
      },
    ]);
    expect(mocks.projects).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId } }),
    );
    expect(mocks.accounts).toHaveBeenCalledWith({
      projectId,
      workspaceId,
      limit: 1,
    });
    expect(mocks.accounts).toHaveBeenCalledWith({
      projectId: secondProjectId,
      workspaceId,
      limit: 1,
    });
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connectionId: { in: [connectionId, secondConnectionId] },
          connection: {
            projectId: { in: [projectId, secondProjectId] },
            project: { workspaceId },
          },
        }),
      }),
    );
  });
  it("uses one deterministic freshest external post for totals and preserves every project attribution", async () => {
    workspaceProjects();
    const original = post(1, { fetchedAt: "2026-10-02T12:00:00Z" });
    const fresher = post(2, {
      externalId: original.externalId,
      connectionId: secondConnectionId,
      fetchedAt: "2026-10-03T12:00:00Z",
      metrics: { ...original.metrics, likes: 0 },
    });
    const previous = post(3, {
      externalId: "previous",
      publishedAt: "2026-09-25T12:00:00Z",
    });
    cachedPosts([
      original,
      fresher,
      previous,
      post(4, {
        ...previous,
        id: post(4).id,
        connectionId: secondConnectionId,
      }),
    ]);
    mocks.snapshots.mockResolvedValue(
      [connectionId, secondConnectionId].map((id) => ({
        connectionId: id,
        date: "2026-10-03T00:00:00Z",
        fetchedAt: "2026-10-03T12:00:00Z",
        profileFetchedAt: "2026-10-03T12:00:00Z",
        metrics: [
          {
            key: "followers_count",
            value: 5,
            period: "lifetime",
            unit: "count",
          },
        ],
        postMetrics: [
          {
            externalId: original.externalId,
            metrics: original.metrics,
            additionalMetrics: original.additionalMetrics,
          },
        ],
      })),
    );
    const result = await listWorkspaceSocialPerformance({
      workspaceId,
      ...query,
    });
    expect(result.summary.current.postCount).toBe(1);
    expect(result.summary.current.metrics.likes.total).toBe(0);
    expect(result.summary.previous.postCount).toBe(1);
    expect(
      result.daily.reduce((total, point) => total + point.summary.postCount, 0),
    ).toBe(1);
    expect(result.posts[0]).toMatchObject({
      id: fresher.id,
      projectIds: [projectId, secondProjectId],
    });
    expect(result.coverage).toMatchObject({
      duplicatePostCopiesExcluded: 1,
      deduplicationBasis: "provider_external_post_id",
    });
    expect(
      result.comparisons.projects.map((item) => item.summary.postCount),
    ).toEqual([1, 1]);
    expect(
      result.comparisons.accounts.map((item) => item.summary.postCount),
    ).toEqual([1, 1]);
    expect(result.followers).toHaveLength(2);
    expect(result.followers.map((series) => series.points[0].value)).toEqual([
      5, 5,
    ]);
    expect(result.observations.map((item) => item.summary.postCount)).toEqual([
      1, 1,
    ]);
    cachedPosts([fresher, original, previous]);
    expect(
      (await listWorkspaceSocialPerformance({ workspaceId, ...query })).posts[0]
        .id,
    ).toBe(fresher.id);
  });
  it("does not collapse distinct platforms with the same external ID", async () => {
    workspaceProjects();
    mocks.accounts
      .mockResolvedValueOnce({ accounts: [account] })
      .mockResolvedValueOnce({
        accounts: [{ ...account, id: secondConnectionId, provider: "youtube" }],
      });
    cachedPosts([
      post(),
      post(2, {
        externalId: "post-1",
        connectionId: secondConnectionId,
        provider: "youtube",
      }),
    ]);
    const result = await listWorkspaceSocialPerformance({
      workspaceId,
      ...query,
    });
    expect(result.summary.current.postCount).toBe(2);
    expect(result.coverage.duplicatePostCopiesExcluded).toBe(0);
  });
  it("breaks equal observation-time ties by cached ID regardless of database order", async () => {
    workspaceProjects();
    const first = post();
    const second = post(2, {
      externalId: first.externalId,
      connectionId: secondConnectionId,
      metrics: { ...first.metrics, likes: null },
    });
    for (const rows of [
      [first, second],
      [second, first],
    ]) {
      cachedPosts(rows);
      const result = await listWorkspaceSocialPerformance({
        workspaceId,
        ...query,
      });
      expect(result.posts[0].id).toBe(second.id);
      expect(result.summary.current.metrics.likes.total).toBeNull();
      expect(result.summary.current.interactions.total).toBeNull();
    }
  });
  it("applies search and format filters to the freshest copy rather than reviving a stale matching copy", async () => {
    workspaceProjects();
    cachedPosts([
      post(1, { text: "launch", fetchedAt: "2026-10-02T00:00:00Z" }),
      post(2, {
        externalId: "post-1",
        connectionId: secondConnectionId,
        text: "new message",
        fetchedAt: "2026-10-03T00:00:00Z",
      }),
    ]);
    const result = await listWorkspaceSocialPerformance({
      workspaceId,
      ...query,
      search: "launch",
    });
    expect(result.summary.current.postCount).toBe(0);
    expect(result.posts).toEqual([]);
    expect(result.coverage.duplicatePostCopiesExcluded).toBe(0);
  });
  it("keeps the complete project catalog when filtering, while narrowing cache and comparison scope", async () => {
    workspaceProjects();
    cachedPosts([post(), post(2, { connectionId: secondConnectionId })]);
    const result = await listWorkspaceSocialPerformance({
      workspaceId,
      projectId: secondProjectId,
      connectionId: secondConnectionId,
      provider: "x",
      ...query,
    });
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].connectionIds).toEqual([connectionId]);
    expect(result.accounts.map((item) => item.id)).toEqual([
      secondConnectionId,
    ]);
    expect(result.comparisons.projects.map((item) => item.projectId)).toEqual([
      secondProjectId,
    ]);
    expect(result.posts[0].projectIds).toEqual([secondProjectId]);
    expect(mocks.posts).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connection: { projectId: secondProjectId, project: { workspaceId } },
          connectionId: { in: [secondConnectionId] },
        }),
      }),
    );
  });
  it("refuses an out-of-workspace project or connection before raw cache reads", async () => {
    workspaceProjects();
    await expect(
      listWorkspaceSocialPerformance({
        workspaceId,
        projectId: workspaceId,
        ...query,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.accounts).not.toHaveBeenCalled();
    await expect(
      listWorkspaceSocialPerformance({
        workspaceId,
        connectionId: workspaceId,
        ...query,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      listWorkspaceSocialPerformance({
        workspaceId,
        projectId,
        connectionId: secondConnectionId,
        ...query,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.posts).not.toHaveBeenCalled();
    expect(mocks.snapshots).not.toHaveBeenCalled();
  });
  it("passes every project through existing read authorization and aborts cache access on failure", async () => {
    workspaceProjects();
    mocks.accounts.mockRejectedValueOnce(new Error("Project access denied"));
    await expect(
      listWorkspaceSocialPerformance({ workspaceId, ...query }),
    ).rejects.toThrow("Project access denied");
    expect(mocks.posts).not.toHaveBeenCalled();
    expect(mocks.snapshots).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });
  it("exports every unique matching post regardless of pagination and adds complete project attribution", async () => {
    workspaceProjects();
    const posts = Array.from({ length: 105 }, (_, index) =>
      post(index + 1, {
        connectionId: index % 2 ? secondConnectionId : connectionId,
      }),
    );
    cachedPosts([
      ...posts,
      post(106, {
        externalId: posts[0].externalId,
        connectionId: secondConnectionId,
      }),
    ]);
    const result = await listWorkspaceSocialPerformance({
      workspaceId,
      ...query,
      offset: 100,
      limit: 1,
      includeAllPosts: true,
    });
    expect(result.posts).toHaveLength(105);
    expect(result.pagination.offset).toBe(0);
    expect(result.summary.current.postCount).toBe(105);
    const { socialPerformanceExportSheets } = await import(
      "@/helpers/social-performance-export"
    );
    const sheets = socialPerformanceExportSheets(result);
    const columns = sheets[0].rows[0];
    expect(sheets[0].rows).toHaveLength(106);
    const duplicatedPost = sheets[0].rows.find(
      (row) => row[columns.indexOf("post_id")] === posts[0].externalId,
    );
    expect(duplicatedPost?.[columns.indexOf("project_ids")]).toBe(
      `${projectId}; ${secondProjectId}`,
    );
    expect(duplicatedPost?.[columns.indexOf("project_names")]).toBe(
      "Launch; Growth",
    );
    expect(sheets.at(-1)).toMatchObject({ name: "Projects" });
    expect(sheets[1].rows).toContainEqual([
      "duplicate_post_copies_excluded",
      1,
    ]);
  });
});
