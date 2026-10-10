import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPost: vi.fn(),
  listPosts: vi.fn(),
  queryRaw: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  fetchMetrics: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: mocks.queryRaw,
    socialPost: { updateMany: mocks.updateMany },
    projectSocialConnection: { findFirst: mocks.findFirst },
  },
}));
vi.mock("@/services/social-posts.service", () => ({
  getSocialPost: mocks.getPost,
  listSocialPosts: mocks.listPosts,
}));
vi.mock("@/clients/social-post-providers/statistics", () => ({
  fetchSocialPostStatistics: mocks.fetchMetrics,
  SocialPostStatisticsUnavailableError: class extends Error {},
}));

import {
  listSocialPostStatistics,
  refreshSocialPostStatistics,
} from "./social-post-statistics.service";

const scope = { projectId: "project", workspaceId: "workspace" };
const metrics = {
  views: null,
  impressions: 100,
  likes: 0,
  comments: 3,
  shares: null,
  saves: null,
};
const snapshot = {
  metrics,
  fetchedAt: "2026-10-01T12:00:00.000Z",
  refreshAttemptedAt: "2026-10-01T12:00:00.000Z",
  error: null,
};
const post = {
  id: "post",
  provider: "x",
  status: "PUBLISHED",
  publishedExternalId: "external",
  socialConnection: { id: "connection" },
  statistics: snapshot,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getPost.mockResolvedValue(post);
  mocks.findFirst.mockResolvedValue({
    id: "connection",
    provider: "x",
    status: "active",
    connectorUserId: "connector",
    externalAccountId: "account",
    composioConnectedAccountId: "connected",
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("Social post statistics", () => {
  it("retains the last measurements and timestamp when refresh fails", async () => {
    mocks.fetchMetrics.mockRejectedValue(new Error("secret provider payload"));
    await refreshSocialPostStatistics({
      ...scope,
      postId: "post",
      userId: "reader",
    });
    const saved = mocks.updateMany.mock.calls[0][0].data.statistics;
    expect(saved.metrics).toEqual(metrics);
    expect(saved.fetchedAt).toBe(snapshot.fetchedAt);
    expect(saved.error).toBe(
      "Unable to refresh statistics. Check the connection and analytics permissions, then retry.",
    );
    expect(JSON.stringify(saved)).not.toContain("secret provider payload");
  });
  it("stores zero as an available measurement and leaves unavailable metrics null", async () => {
    mocks.fetchMetrics.mockResolvedValue(metrics);
    await refreshSocialPostStatistics({
      ...scope,
      postId: "post",
      userId: "reader",
    });
    expect(mocks.updateMany.mock.calls[0][0].data.statistics).toMatchObject({
      metrics,
      error: null,
    });
    expect(mocks.fetchMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        executorUserId: "sokosumi:project-executor:project",
        externalId: "external",
        connectedAccountId: "connected",
      }),
    );
  });
  it("rejects cross-workspace reads before contacting a provider", async () => {
    mocks.getPost.mockRejectedValue(new Error("Post not found"));
    await expect(
      refreshSocialPostStatistics({
        ...scope,
        postId: "other",
        userId: "reader",
      }),
    ).rejects.toThrow("Post not found");
    expect(mocks.fetchMetrics).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("never queries a provider for drafts", async () => {
    mocks.getPost.mockResolvedValue({
      ...post,
      status: "DRAFT",
      publishedExternalId: null,
    });
    await expect(
      refreshSocialPostStatistics({
        ...scope,
        postId: "post",
        userId: "reader",
      }),
    ).rejects.toThrow();
    expect(mocks.fetchMetrics).not.toHaveBeenCalled();
  });
  it("returns database platform aggregates independently of the paginated posts", async () => {
    mocks.listPosts.mockResolvedValue({
      posts: [post],
      pagination: { nextCursor: "next" },
    });
    const summary = [
      {
        provider: "x",
        postCount: 3,
        measuredPostCount: 2,
        metrics: { ...metrics, impressions: 150, likes: 2, comments: 6 },
      },
    ];
    mocks.queryRaw.mockResolvedValue(summary);
    const from = new Date("2026-10-01T00:00:00Z");
    const until = new Date("2026-10-08T23:59:59Z");
    const result = await listSocialPostStatistics({
      ...scope,
      provider: "x",
      publishedFrom: from,
      publishedUntil: until,
    });
    expect(result).toEqual({ posts: [post], summary, nextCursor: "next" });
    const query = mocks.queryRaw.mock.calls[0][0];
    expect(query.values.slice(1)).toEqual([
      "project",
      "workspace",
      "x",
      "x",
      from,
      from,
      until,
      until,
    ]);
    expect(query.text).toContain("GROUP BY provider");
    expect(query.values[0]).toMatch(/^\^/);
    expect(mocks.listPosts).toHaveBeenCalledWith(
      expect.objectContaining({ ...scope, statuses: ["PUBLISHED"] }),
    );
  });

  it("rejects unsafe aggregate counters at the raw SQL boundary", async () => {
    mocks.listPosts.mockResolvedValue({
      posts: [],
      pagination: { nextCursor: null },
    });
    mocks.queryRaw.mockResolvedValue([
      {
        provider: "x",
        postCount: 2,
        measuredPostCount: 2,
        metrics: { ...metrics, impressions: Number.MAX_SAFE_INTEGER + 1 },
      },
    ]);
    await expect(listSocialPostStatistics(scope)).rejects.toThrow();
  });

  it("does not run aggregation before Project/workspace authorization", async () => {
    mocks.listPosts.mockRejectedValue(new Error("Project not found"));
    await expect(listSocialPostStatistics(scope)).rejects.toThrow(
      "Project not found",
    );
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });
  it.runIf(process.env.SOCIAL_STATISTICS_TEST_DATABASE_URL)(
    "excludes malformed snapshots consistently with the service schema in PostgreSQL",
    async () => {
      const { Client } = await import("pg");
      const client = new Client({
        connectionString: process.env.SOCIAL_STATISTICS_TEST_DATABASE_URL,
      });
      await client.connect();
      try {
        await client.query(`CREATE TEMP TABLE social_post (
          "projectId" uuid, "workspaceId" uuid, provider text, status text,
          "publishedAt" timestamp, statistics jsonb
        )`);
        const pgScope = {
          projectId: "00000000-0000-4000-8000-000000000001",
          workspaceId: "00000000-0000-4000-8000-000000000002",
        };
        const malformed = [
          { fetchedAt: "bad", metrics: { likes: 1 } },
          { ...snapshot, fetchedAt: "2026-02-30T12:00:00.000Z" },
          { ...snapshot, fetchedAt: "2025-02-29T12:00:00.000Z" },
          { ...snapshot, refreshAttemptedAt: "2026-04-31T12:00:00.000Z" },
          { ...snapshot, error: 42 },
          { ...snapshot, metrics: { likes: 100 } },
          { ...snapshot, metrics: { ...metrics, likes: "100" } },
          { ...snapshot, metrics: { ...metrics, likes: -1 } },
          { ...snapshot, metrics: { ...metrics, likes: 0.5 } },
          {
            ...snapshot,
            metrics: { ...metrics, likes: Number.MAX_SAFE_INTEGER + 1 },
          },
          { ...snapshot, fetchedAt: null },
          { ...snapshot, metrics: null },
          null,
        ];
        for (const value of [
          snapshot,
          { ...snapshot, fetchedAt: "2026-10-01T12:00:00Z" },
          {
            ...snapshot,
            fetchedAt: "2024-02-29T12:00:00.000Z",
            refreshAttemptedAt: null,
          },
          ...malformed,
        ]) {
          await client.query(
            "INSERT INTO social_post VALUES ($1,$2,$3,$4,$5,$6)",
            [
              pgScope.projectId,
              pgScope.workspaceId,
              "x",
              "PUBLISHED",
              "2026-10-01",
              value,
            ],
          );
        }
        mocks.listPosts.mockResolvedValue({
          posts: [],
          pagination: { nextCursor: null },
        });
        mocks.queryRaw.mockImplementation(
          async (query) => (await client.query(query.text, query.values)).rows,
        );
        const result = await listSocialPostStatistics(pgScope);
        expect(result.summary).toEqual([
          {
            provider: "x",
            postCount: malformed.length + 3,
            measuredPostCount: 3,
            metrics: { ...metrics, impressions: 300, comments: 9 },
          },
        ]);
      } finally {
        await client.end();
      }
    },
  );
});
