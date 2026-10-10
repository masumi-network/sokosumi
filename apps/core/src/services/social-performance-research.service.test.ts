import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  accounts: vi.fn(),
  connection: vi.fn(),
  post: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    projectSocialConnection: { findFirst: mocks.connection },
    socialAccountPost: { findFirst: mocks.post },
  },
}));
vi.mock("@/services/project-social-connections.service", () => ({
  listProjectSocialConnections: mocks.accounts,
}));
vi.mock(
  "@/clients/social-post-providers/account-statistics",
  async (original) => ({
    ...(await original<
      typeof import("@/clients/social-post-providers/account-statistics")
    >()),
    readNativeStatistics: mocks.read,
  }),
);

import {
  readSocialPerformanceAudience,
  readSocialPerformanceBenchmark,
  readSocialPerformanceDiscovery,
} from "./social-performance-research.service";

const scope = {
  projectId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  connectionId: "33333333-3333-4333-8333-333333333333",
};
const account = {
  id: scope.connectionId,
  provider: "x",
  externalHandle: "launch",
  displayName: "Launch",
  avatarUrl: null,
  status: "active",
  connectedAt: new Date("2026-10-01T12:00:00Z"),
  disconnectedAt: null,
};
const connection = {
  ...account,
  externalAccountId: "123",
  composioConnectedAccountId: "ca-own",
  connectorUserId: "executor-own",
};
const postId = "44444444-4444-4444-8444-444444444444";
const user = {
  id: "456",
  username: "reader",
  name: "Reader",
  description: "Public biography",
  location: "Self-reported location",
  profile_image_url: "https://pbs.twimg.com/profile.png",
  public_metrics: { followers_count: 0 },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  mocks.accounts.mockResolvedValue([account]);
  mocks.connection.mockResolvedValue(connection);
  mocks.post.mockResolvedValue({
    externalId: "789",
    publishedAt: new Date("2026-10-01T12:00:00Z"),
    postKind: "post",
  });
});
afterEach(() => vi.useRealTimers());

describe("scoped X audience and public benchmarking", () => {
  it.each([
    { topic: "from:other OR secret" },
    { topic: "launch", publishedFrom: "2026-09-30T00:00:00Z" },
    { topic: "launch", publishedUntil: "2026-10-09T00:00:00Z" },
    { topic: "launch", minFollowers: 100, maxFollowers: 50 },
    { topic: "launch", limit: 101 },
    {},
  ])(
    "rejects invalid discovery search filters before credential or provider reads",
    async (query) => {
      await expect(
        readSocialPerformanceDiscovery({ ...scope, ...query }),
      ).rejects.toThrow();
      expect(mocks.accounts).not.toHaveBeenCalled();
      expect(mocks.connection).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it("uses a fixed recent search endpoint with constrained operators and sampled thresholds without replacing missing counters", async () => {
    const row = (
      id: string,
      authorId: string,
      impressions: number | null,
      likes: number,
    ) => ({
      id,
      author_id: authorId,
      text: "Public launch",
      created_at: "2026-10-06T12:00:00Z",
      attachments: { media_keys: ["image-1"] },
      public_metrics: {
        impression_count: impressions,
        like_count: likes,
        reply_count: 0,
        repost_count: 0,
        quote_count: 0,
      },
      non_public_metrics: { url_link_clicks: 99 },
    });
    mocks.read.mockResolvedValue({
      data: [
        row("1", "456", 100, 20),
        row("2", "456", null, 20),
        row("3", "456", 100, 1),
        row("4", "999", 100, 20),
      ],
      includes: {
        users: [
          { ...user, public_metrics: { followers_count: 100 } },
          {
            ...user,
            id: "999",
            username: "smaller",
            public_metrics: { followers_count: 10 },
          },
        ],
        media: [
          {
            media_key: "image-1",
            type: "photo",
            url: "https://pbs.twimg.com/image.png",
          },
        ],
      },
      meta: { next_token: "next_search_page" },
    });
    const result = await readSocialPerformanceDiscovery({
      ...scope,
      topic: "launch",
      username: "reader",
      language: "en",
      format: "image",
      minLikes: 10,
      minImpressions: 10,
      minFollowers: 50,
      maxFollowers: 200,
      limit: 10,
      cursor: "search_page",
      sort: "likes",
    });
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: "ca-own" }),
      "https://api.x.com/2/tweets/search/recent",
      expect.arrayContaining([
        {
          name: "query",
          value:
            '"launch" from:reader lang:en has:images -is:retweet -is:reply',
          type: "query",
        },
        { name: "next_token", value: "search_page", type: "query" },
        { name: "max_results", value: "10", type: "query" },
      ]),
    );
    expect(result.samplePostCount).toBe(4);
    expect(result.matchedPostCount).toBe(1);
    expect(result.missingCounterPostCount).toBe(1);
    expect(result.posts[0]).toMatchObject({
      author: { id: "456", followersCount: 100 },
      post: {
        externalId: "1",
        contentType: "image",
        metrics: { impressions: 100, likes: 20 },
      },
      interactionType: null,
    });
    expect(
      result.posts[0]?.post.additionalMetrics.map((value) => value.key),
    ).toEqual(["quote_count"]);
    expect(result.coverage).toContain("within this fetched page");
    expect(result.coverage).toContain("Missing required counters are excluded");
    expect(result.nextCursor).toBe("next_search_page");
  });
  it("sorts discovered public posts by measured counters and keeps unknown values at the end", async () => {
    mocks.read.mockResolvedValue({
      data: [
        {
          id: "1",
          author_id: "456",
          text: "First",
          created_at: "2026-10-05T12:00:00Z",
          public_metrics: { like_count: 9 },
        },
        {
          id: "2",
          author_id: "456",
          text: "Second",
          created_at: "2026-10-06T12:00:00Z",
          public_metrics: { like_count: 20 },
        },
        {
          id: "3",
          author_id: "456",
          text: "Unknown",
          created_at: "2026-10-07T12:00:00Z",
        },
      ],
      includes: { users: [user] },
      meta: { result_count: 3 },
    });
    const result = await readSocialPerformanceDiscovery({
      ...scope,
      username: "reader",
      sort: "likes",
      publishedFrom: "2026-10-05T14:00:00+02:00",
      publishedUntil: "2026-10-08T12:00:00Z",
    });
    expect(result.publishedFrom).toBe("2026-10-05T12:00:00.000Z");
    expect(result.posts.map((value) => value.post.externalId)).toEqual([
      "2",
      "1",
      "3",
    ]);
    expect(result.posts[2]?.post.metrics.likes).toBeNull();
  });
  it("keeps resolved discovery bounds through cursor reads and rejects an expired window without sliding it", async () => {
    mocks.read.mockResolvedValue({
      data: [],
      meta: { result_count: 0, next_token: "next_search_page" },
    });
    const first = await readSocialPerformanceDiscovery({
      ...scope,
      topic: "launch",
    });
    expect(first.publishedFrom).toBe("2026-10-01T13:00:00.000Z");
    expect(first.publishedUntil).toBe("2026-10-08T12:00:00.000Z");
    vi.setSystemTime(new Date("2026-10-08T12:10:00Z"));
    const query = {
      ...scope,
      topic: "launch",
      cursor: "next_search_page",
      publishedFrom: first.publishedFrom,
      publishedUntil: first.publishedUntil,
    };
    const second = await readSocialPerformanceDiscovery(query);
    expect(second.publishedFrom).toBe(first.publishedFrom);
    expect(second.publishedUntil).toBe(first.publishedUntil);
    expect(mocks.read).toHaveBeenLastCalledWith(
      expect.objectContaining({ connectedAccountId: "ca-own" }),
      "https://api.x.com/2/tweets/search/recent",
      expect.arrayContaining([
        { name: "start_time", value: first.publishedFrom, type: "query" },
        { name: "end_time", value: first.publishedUntil, type: "query" },
      ]),
    );
    vi.setSystemTime(new Date("2026-10-08T13:01:00Z"));
    mocks.read.mockClear();
    mocks.accounts.mockClear();
    await expect(readSocialPerformanceDiscovery(query)).rejects.toThrow(
      "This X discovery cursor range has expired. Start a new search within the last seven days.",
    );
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("excludes protected content from public discovery and public benchmarks", async () => {
    mocks.read.mockResolvedValue({
      data: [
        {
          id: "1",
          author_id: "456",
          text: "Protected",
          created_at: "2026-10-07T12:00:00Z",
        },
      ],
      includes: { users: [{ ...user, protected: true }] },
      meta: { result_count: 1 },
    });
    expect(
      (await readSocialPerformanceDiscovery({ ...scope, topic: "launch" }))
        .posts,
    ).toEqual([]);
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: "ca-own" }),
      "https://api.x.com/2/tweets/search/recent",
      expect.arrayContaining([
        {
          name: "user.fields",
          value: expect.stringMatching(/(?:^|,)protected(?:,|$)/),
          type: "query",
        },
      ]),
    );
    mocks.read.mockClear();
    mocks.read.mockResolvedValue({ data: { ...user, protected: true } });
    await expect(
      readSocialPerformanceBenchmark({ ...scope, username: "reader" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({ connectedAccountId: "ca-own" }),
      "https://api.x.com/2/users/by/username/reader",
      expect.arrayContaining([
        {
          name: "user.fields",
          value: expect.stringMatching(/(?:^|,)protected(?:,|$)/),
          type: "query",
        },
      ]),
    );
  });
  it("reports empty discovery samples and safe provider failures", async () => {
    mocks.read.mockResolvedValue({ meta: { result_count: 0 } });
    expect(
      await readSocialPerformanceDiscovery({ ...scope, topic: "launch" }),
    ).toMatchObject({
      posts: [],
      samplePostCount: 0,
      matchedPostCount: 0,
      missingCounterPostCount: 0,
    });
    mocks.read.mockRejectedValue(
      new Error("search denied access_token=secret"),
    );
    await expect(
      readSocialPerformanceDiscovery({ ...scope, topic: "launch" }),
    ).rejects.toThrow("X recent discovery is unavailable");
  });
  it("retains incoming mention content and counters as citeable evidence while deduplicating contact contributions", async () => {
    const mentioned = {
      id: "789",
      author_id: "456",
      text: "What a launch",
      created_at: "2026-10-07T12:00:00Z",
      in_reply_to_user_id: "123",
      public_metrics: {
        impression_count: 30,
        like_count: 0,
        reply_count: 1,
        repost_count: 0,
        quote_count: 0,
      },
      non_public_metrics: { url_link_clicks: 10 },
    };
    mocks.read.mockResolvedValue({
      data: [mentioned, mentioned],
      includes: { users: [user] },
      meta: { result_count: 2 },
    });
    const result = await readSocialPerformanceAudience(scope);
    expect(result.contacts[0]).toMatchObject({ interactions: 1, replies: 1 });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      author: { id: "456" },
      interactionType: "reply",
      post: {
        externalId: "789",
        text: "What a launch",
        url: "https://x.com/i/status/789",
        metrics: { impressions: 30, likes: 0 },
      },
    });
    expect(
      result.posts[0]?.post.additionalMetrics.map((value) => value.key),
    ).toEqual(["quote_count"]);
  });
  it.each(["likers", "reposters"] as const)(
    "reads a scoped cached post's %s after confirming ownership, before reading account credentials",
    async (kind) => {
      mocks.post.mockImplementationOnce(async () => {
        expect(mocks.connection).not.toHaveBeenCalled();
        expect(mocks.read).not.toHaveBeenCalled();
        return {
          externalId: "789",
          publishedAt: new Date("2026-10-01T12:00:00Z"),
          postKind: "post",
        };
      });
      mocks.read.mockResolvedValue({
        data: [user],
        meta: { next_token: "next_page" },
      });
      const result = await readSocialPerformanceAudience({
        ...scope,
        kind,
        postId,
      });
      expect(mocks.post).toHaveBeenCalledWith({
        where: {
          id: postId,
          connectionId: scope.connectionId,
          connection: {
            projectId: scope.projectId,
            project: { workspaceId: scope.workspaceId },
            provider: "x",
            status: "active",
          },
        },
        select: { externalId: true, publishedAt: true, postKind: true },
      });
      expect(mocks.read.mock.calls[0]?.[1]).toBe(
        `https://api.x.com/2/tweets/789/${kind === "likers" ? "liking_users" : "retweeted_by"}`,
      );
      expect(result).toMatchObject({
        kind,
        postId,
        samplePostCount: 1,
        oldestPostAt: "2026-10-01T12:00:00.000Z",
      });
      expect(result.contacts[0]).toMatchObject({
        interactions: 1,
        likes: kind === "likers" ? 1 : null,
        reposts: kind === "reposters" ? 1 : null,
        replies: null,
        mentions: null,
      });
      expect(result.coverage).toContain("one post");
    },
  );
  it.each([
    null,
    { externalId: null, postKind: "post" },
    { externalId: "789?target=123", postKind: "post" },
    { externalId: "789", postKind: "repost" },
  ])(
    "rejects wrong-project, invalid and repost cache entries without exposing credentials or calling X",
    async (value) => {
      mocks.post.mockResolvedValue(value);
      await expect(
        readSocialPerformanceAudience({ ...scope, kind: "likers", postId }),
      ).rejects.toMatchObject({ status: 404 });
      expect(mocks.connection).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it("requires a cached post UUID for likes and reposts before any scope or provider lookup", async () => {
    await expect(
      readSocialPerformanceAudience({ ...scope, kind: "likers" }),
    ).rejects.toThrow();
    await expect(
      readSocialPerformanceAudience({
        ...scope,
        kind: "reposters",
        postId: "789",
      }),
    ).rejects.toThrow();
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("checks workspace access before looking up credentials or calling the provider", async () => {
    mocks.accounts.mockRejectedValue(new Error("Workspace access denied"));
    await expect(readSocialPerformanceAudience(scope)).rejects.toThrow(
      "Workspace access denied",
    );
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([
    { accounts: [], raw: connection },
    { accounts: [account], raw: null },
    {
      accounts: [account],
      raw: { ...connection, externalAccountId: "123/../456" },
    },
  ])(
    "rejects unavailable or malformed scoped accounts before provider access",
    async ({ accounts, raw }) => {
      mocks.accounts.mockResolvedValue(accounts);
      mocks.connection.mockResolvedValue(raw);
      await expect(readSocialPerformanceAudience(scope)).rejects.toMatchObject({
        status: 404,
      });
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...account, provider: "youtube" },
    { ...account, status: "disconnected" },
  ])("requires an active X account", async (value) => {
    mocks.accounts.mockResolvedValue([value]);
    await expect(readSocialPerformanceAudience(scope)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("paginates followers through the pinned account and preserves unknown interaction counts", async () => {
    mocks.read.mockResolvedValue({
      data: [user],
      meta: { next_token: "next_page-2" },
    });
    const result = await readSocialPerformanceAudience({
      ...scope,
      kind: "followers",
      cursor: "first_page",
      limit: 5,
    });
    expect(mocks.connection).toHaveBeenCalledWith({
      where: {
        id: scope.connectionId,
        projectId: scope.projectId,
        project: { workspaceId: scope.workspaceId },
        provider: "x",
        status: "active",
      },
    });
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedAccountId: "ca-own",
        executorUserId: "executor-own",
        externalAccountId: "123",
      }),
      "https://api.x.com/2/users/123/followers",
      expect.arrayContaining([
        { name: "max_results", value: "5", type: "query" },
        { name: "pagination_token", value: "first_page", type: "query" },
      ]),
    );
    expect(result.contacts).toEqual([
      expect.objectContaining({
        id: "456",
        followersCount: 0,
        interactions: null,
        replies: null,
      }),
    ]);
    expect(result.nextCursor).toBe("next_page-2");
    expect(result.coverage).toContain("does not identify when they followed");
  });

  it("counts replies and quotes to the selected account and keeps unrelated references as mentions", async () => {
    mocks.read.mockResolvedValue({
      data: [
        {
          id: "1",
          author_id: "456",
          created_at: "2026-10-06T12:00:00Z",
          in_reply_to_user_id: "123",
          referenced_posts: [{ id: "own-post", type: "replied_to" }],
        },
        {
          id: "2",
          author_id: "456",
          created_at: "2026-10-07T12:00:00Z",
          referenced_posts: [{ id: "own-post", type: "quoted" }],
        },
        {
          id: "3",
          author_id: "456",
          referenced_posts: [{ id: "other-post", type: "replied_to" }],
        },
        { id: "4", author_id: "123" },
      ],
      includes: {
        users: [user],
        posts: [
          { id: "own-post", author_id: "123" },
          { id: "other-post", author_id: "999" },
        ],
      },
      meta: { result_count: 4 },
    });
    const result = await readSocialPerformanceAudience(scope);
    expect(result.contacts).toEqual([
      expect.objectContaining({
        interactions: 3,
        replies: 1,
        quotes: 1,
        mentions: 1,
      }),
    ]);
    expect(result.oldestPostAt).toBe("2026-10-06T12:00:00.000Z");
    expect(result.newestPostAt).toBe("2026-10-07T12:00:00.000Z");
    expect(result.coverage).toContain("this page");
    expect(result.coverage).toContain("800");
  });

  it("returns an empty sample without inventing demographics or users", async () => {
    mocks.read.mockResolvedValue({ meta: { result_count: 0 } });
    const result = await readSocialPerformanceAudience(scope);
    expect(result.contacts).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.samplePostCount).toBe(0);
  });

  it("maps provider failure and malformed cursors to a safe unavailable response", async () => {
    mocks.read.mockRejectedValue(new Error("access_token=secret"));
    await expect(readSocialPerformanceAudience(scope)).rejects.toMatchObject({
      status: 503,
    });
    mocks.read.mockResolvedValue({
      data: [],
      meta: { next_token: "https://evil.test/?access_token=secret" },
    });
    await expect(readSocialPerformanceAudience(scope)).rejects.toThrow(
      "X audience data is unavailable",
    );
  });

  it("validates the benchmark handle before account or provider access", async () => {
    await expect(
      readSocialPerformanceBenchmark({ ...scope, username: "https://evil" }),
    ).rejects.toThrow();
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("uses real public counters and media without disclosing private clicks in benchmarks", async () => {
    mocks.read
      .mockResolvedValueOnce({
        data: { ...user, public_metrics: { followers_count: 100 } },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "789",
            author_id: "456",
            text: "Public post",
            created_at: "2026-10-01T12:00:00Z",
            attachments: { media_keys: ["image-1"] },
            public_metrics: {
              impression_count: 200,
              like_count: 10,
              reply_count: 2,
              repost_count: 3,
              quote_count: 1,
              bookmark_count: 0,
            },
            non_public_metrics: { url_link_clicks: 50 },
          },
        ],
        includes: {
          media: [
            {
              media_key: "image-1",
              type: "photo",
              url: "https://pbs.twimg.com/post.png",
            },
          ],
        },
        meta: { next_token: "more_posts" },
      });
    const result = await readSocialPerformanceBenchmark({
      ...scope,
      username: "reader",
    });
    expect(mocks.read.mock.calls[0]?.[1]).toBe(
      "https://api.x.com/2/users/by/username/reader",
    );
    expect(mocks.read.mock.calls[1]?.[1]).toBe(
      "https://api.x.com/2/users/456/tweets",
    );
    expect(result.summary.metrics.impressions.total).toBe(200);
    expect(result.meanImpressionsToFollowers).toBe(2);
    expect(result.posts[0]).toMatchObject({
      provider: "x",
      contentType: "image",
      interactions: 16,
      engagementRate: 8,
    });
    expect(
      result.posts[0]?.additionalMetrics.map((value) => value.key),
    ).toEqual(["quote_count"]);
    expect(result.coverage).toContain("More posts exist");
    expect(result.coverage).toContain("repeat views");
  });

  it("keeps benchmark exposure ratios unavailable when the follower base is zero", async () => {
    mocks.read
      .mockResolvedValueOnce({ data: user })
      .mockResolvedValueOnce({ meta: { result_count: 0 } });
    const result = await readSocialPerformanceBenchmark({
      ...scope,
      username: "reader",
    });
    expect(result.meanImpressionsToFollowers).toBeNull();
    expect(result.posts).toEqual([]);
    expect(result.summary.postCount).toBe(0);
  });
});
