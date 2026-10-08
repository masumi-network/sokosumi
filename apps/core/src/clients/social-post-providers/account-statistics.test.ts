import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchSocialAccountStatisticsPage,
  type SocialAccountStatisticsContext,
} from "@/clients/social-post-providers/account-statistics";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => null }));
const input: SocialAccountStatisticsContext = {
  provider: "x",
  connectedAccountId: "ca_1",
  executorUserId: "executor",
  externalAccountId: "123",
  externalHandle: "name",
  cursor: null,
  includeProfile: true,
};
interface Request {
  tool_slug?: string;
  arguments?: Record<string, unknown>;
  endpoint?: string;
  connected_account_id?: string;
  method?: string;
  parameters?: { name: string; value: string; type: string }[];
}
function stub(respond: (request: Request) => unknown) {
  const requests: Request[] = [];
  const sessions: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
    if (init?.method === "DELETE") return new Response("{}");
    const body = JSON.parse(String(init?.body));
    if (url.pathname.endsWith("/session")) {
      sessions.push(body);
      return new Response(JSON.stringify({ session_id: "sess_test" }));
    }
    requests.push(body);
    const result = respond(body);
    if (result instanceof Error) throw result;
    if (result instanceof Response) return result;
    return new Response(
      JSON.stringify(
        url.pathname.endsWith("/proxy")
          ? result
          : { data: { data: result }, successful: true },
      ),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, sessions, fetchMock };
}
beforeEach(() => {
  getEnvMock.mockReturnValue({ COMPOSIO_API_KEY: "test-key" });
});
afterEach(() => vi.unstubAllGlobals());

describe("connected account statistics", () => {
  it("reports YouTube quota exhaustion and skips history requests that cannot succeed", async () => {
    const { requests } = stub(
      () =>
        new Response(
          JSON.stringify({
            successful: false,
            error: JSON.stringify({
              error: {
                code: 403,
                message:
                  'The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.',
                errors: [{ domain: "youtube.quota", reason: "quotaExceeded" }],
              },
            }),
          }),
        ),
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "youtube",
    });
    expect(result.accountError).toContain("YouTube API quota is exhausted");
    expect(result.historyError).toBe(result.accountError);
    expect(result.historyError).toContain("midnight Pacific Time");
    expect(requests.map((request) => request.tool_slug)).toEqual([
      "YOUTUBE_LIST_CHANNELS",
    ]);
  });

  it("preserves sanitized provider refusal details for account totals and history", async () => {
    stub(
      () =>
        new Response(
          JSON.stringify({
            successful: false,
            error: {
              message:
                "Request had insufficient authentication scopes. access_token=private-token",
              status: 403,
            },
          }),
        ),
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "youtube",
    });
    expect(result.accountError).toContain("insufficient authentication scopes");
    expect(result.historyError).toContain("insufficient authentication scopes");
    expect(result.accountError).not.toContain("private-token");
    expect(result.historyError).not.toContain("private-token");
  });

  it("pins read sessions and X native authored history; ignores other authors and preserves zero/null", async () => {
    const { sessions, requests, fetchMock } = stub((request) =>
      request.tool_slug
        ? {
            id: "123",
            public_metrics: {
              followers_count: 0,
              following_count: 9,
              tweet_count: 12,
            },
          }
        : {
            status: 200,
            data: {
              data: [
                {
                  id: "456",
                  author_id: "123",
                  text: "Outside Sokosumi",
                  created_at: "2026-01-01T00:00:00Z",
                  public_metrics: {
                    like_count: 0,
                    quote_count: 2,
                    impression_count: "9007199254740992",
                  },
                },
                { id: "other", author_id: "999", text: "Someone else" },
              ],
              meta: { next_token: "token_2" },
            },
          },
    );
    const result = await fetchSocialAccountStatisticsPage(input);
    expect(result.accountMetrics).toContainEqual({
      key: "followers_count",
      value: 0,
      period: "lifetime",
      unit: "count",
    });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      externalId: "456",
      text: "Outside Sokosumi",
      publishedAt: "2026-01-01T00:00:00.000Z",
      metrics: { likes: 0, impressions: null },
      additionalMetrics: [{ key: "quote_count", value: 2 }],
    });
    expect(result.nextCursor).toBe("token_2");
    expect(sessions[0]).toMatchObject({
      connected_accounts: { twitter: ["ca_1"] },
      tools: { twitter: { enable: ["TWITTER_USER_LOOKUP_ME"] } },
      workbench: { enable: false, enable_proxy_execution: false },
    });
    expect(requests[1]).toMatchObject({
      endpoint: "https://api.x.com/2/users/123/tweets",
      method: "GET",
      connected_account_id: "ca_1",
      parameters: [
        { name: "max_results", type: "query" },
        { name: "post.fields", type: "query" },
      ],
    });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });
  it("passes provider cursor as an isolated query value and omits profile on continuation", async () => {
    const { requests } = stub(() => ({
      status: 200,
      data: { data: [], meta: { result_count: 0 } },
    }));
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      includeProfile: false,
      cursor: "token_2",
    });
    expect(result.accountMetrics).toBeNull();
    expect(result.historyError).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0].parameters).toContainEqual({
      name: "pagination_token",
      type: "query",
      value: "token_2",
    });
  });
  it.each([
    "https://evil.test/?access_token=secret",
    "token&fields=access_token",
    "bad\nheader",
  ])("rejects unsafe cursor %s without proxy execution", async (cursor) => {
    const { requests } = stub(() => ({ status: 200, data: { data: [] } }));
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      cursor,
      includeProfile: false,
    });
    expect(requests).toHaveLength(0);
    expect(result.historyError).toContain("unavailable");
  });
  it("rejects account path injection", async () => {
    const { requests } = stub(() => ({ status: 200, data: { data: [] } }));
    await fetchSocialAccountStatisticsPage({
      ...input,
      externalAccountId: "123/messages",
      includeProfile: false,
    });
    expect(requests).toHaveLength(0);
  });
  it("keeps profile and history failures independent and never leaks raw failures", async () => {
    stub((request) =>
      request.tool_slug
        ? new Error("Bearer secret https://secret.test")
        : { status: 200, data: { data: [], meta: { result_count: 0 } } },
    );
    const result = await fetchSocialAccountStatisticsPage(input);
    expect(result.accountError).toContain("unavailable");
    expect(result.historyError).toBeNull();
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("treats upstream proxy 403 as failed history, not an empty completed account", async () => {
    stub((request) =>
      request.tool_slug
        ? { id: "123", public_metrics: { followers_count: 3 } }
        : { status: 403, data: { error: { message: "token=secret" } } },
    );
    const result = await fetchSocialAccountStatisticsPage(input);
    expect(result.accountMetrics?.[0].value).toBe(3);
    expect(result.historyError).toContain("unavailable");
    expect(result.posts).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("accepts X's documented empty response without data", async () => {
    stub(() => ({ status: 200, data: { meta: { result_count: 0 } } }));
    expect(
      (
        await fetchSocialAccountStatisticsPage({
          ...input,
          includeProfile: false,
        })
      ).historyError,
    ).toBeNull();
  });
  it("rejects nonadvancing or missing pagination rather than falsely completing history", async () => {
    stub(() => ({
      status: 200,
      data: { data: [], meta: { next_token: "same" } },
    }));
    expect(
      (
        await fetchSocialAccountStatisticsPage({
          ...input,
          includeProfile: false,
          cursor: "same",
        })
      ).historyError,
    ).toContain("unavailable");
  });
  it("imports Facebook own published posts, paginates through after, never stores paging URLs or drafts", async () => {
    const { requests } = stub((request) =>
      request.tool_slug === "FACEBOOK_GET_POST_INSIGHTS"
        ? {
            data: [
              {
                name: "post_media_view",
                period: "lifetime",
                values: [{ value: 0 }],
              },
            ],
          }
        : {
            status: 200,
            data: {
              data: [
                {
                  id: "123_1",
                  message: "Page post",
                  is_published: true,
                  created_time: "2026-01-01T12:00:00+0200",
                  permalink_url: "javascript:alert(1)",
                  reactions: { summary: { total_count: 4 } },
                },
                { id: "123_2", is_published: false },
                { id: "999_1", message: "Wrong page" },
              ],
              paging: {
                cursors: { after: "next" },
                next: "https://graph.facebook.com/?access_token=secret",
              },
            },
          },
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "facebook",
      includeProfile: false,
      cursor: "previous",
    });
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0]).toMatchObject({
      url: null,
      publishedAt: "2026-01-01T10:00:00.000Z",
      metrics: { likes: 4, views: 0 },
    });
    expect(result.nextCursor).toBe("next");
    expect(requests[0]).toMatchObject({
      endpoint: "https://graph.facebook.com/v26.0/123/posts",
      connected_account_id: "ca_1",
      method: "GET",
    });
    expect(requests[0].parameters).toContainEqual({
      name: "after",
      value: "previous",
      type: "query",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("preserves imported Meta posts when optional insights are denied", async () => {
    stub((request) =>
      request.tool_slug
        ? new Error("insights denied")
        : {
            status: 200,
            data: {
              data: [
                {
                  id: "123_1",
                  message: "Available",
                  reactions: { summary: { total_count: 0 } },
                },
              ],
            },
          },
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "facebook",
      includeProfile: false,
    });
    expect(result.posts[0].metrics.likes).toBe(0);
    expect(result.metricWarning).toContain("imported");
    expect(result.historyError).toBeNull();
  });
  it("loads Instagram baseline and lifetime insights with opaque after and canonical dates", async () => {
    const { requests } = stub((request) =>
      request.tool_slug === "INSTAGRAM_GET_IG_USER_MEDIA"
        ? {
            data: [
              {
                id: "ig1",
                caption: "Feed",
                timestamp: "2026-02-01T00:00:00+00:00",
                permalink: "https://instagram.com/p/ig1",
                like_count: 0,
                comments_count: 2,
              },
            ],
            paging: {
              cursors: { after: "after_2" },
              next: "https://provider.test?token=secret",
            },
          }
        : {
            data: [
              { name: "views", period: "lifetime", values: [{ value: 0 }] },
              { name: "saved", period: "lifetime", total_value: { value: 2 } },
              { name: "reach", period: "lifetime", values: [{ value: 4 }] },
            ],
          },
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "instagram",
      includeProfile: false,
      cursor: "after_1",
    });
    expect(requests[0].arguments).toMatchObject({
      after: "after_1",
      limit: 10,
      ig_user_id: "123",
    });
    expect(result.posts[0]).toMatchObject({
      publishedAt: "2026-02-01T00:00:00.000Z",
      metrics: { likes: 0, views: 0, saves: 2 },
      additionalMetrics: [{ key: "reach", value: 4 }],
    });
    expect(result.nextCursor).toBe("after_2");
  });
  it("uses YouTube published video date and own channel, batch counters; preserves hidden subscribers", async () => {
    const { requests } = stub((request) => {
      if (request.tool_slug === "YOUTUBE_LIST_CHANNELS")
        return {
          items: [
            {
              id: "123",
              statistics: {
                subscriberCount: "20",
                hiddenSubscriberCount: true,
                viewCount: "0",
                videoCount: "1",
              },
            },
          ],
        };
      if (request.tool_slug === "YOUTUBE_LIST_CHANNEL_VIDEOS")
        return {
          items: [
            {
              snippet: {
                publishedAt: "2026-01-01T00:00:00Z",
                resourceId: { videoId: "v1" },
              },
            },
          ],
          nextPageToken: "page_2",
        };
      return {
        items: [
          {
            id: "v1",
            snippet: {
              channelId: "123",
              description: "Video",
              publishedAt: "2020-01-01T00:00:00Z",
            },
            statistics: {
              viewCount: "100",
              likeCount: "0",
              dislikeCount: "1",
              favoriteCount: "0",
            },
          },
        ],
      };
    });
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "youtube",
    });
    expect(result.accountMetrics).toContainEqual({
      key: "subscriberCount",
      value: null,
      period: "lifetime",
      unit: "count",
    });
    expect(result.posts[0]).toMatchObject({
      publishedAt: "2020-01-01T00:00:00.000Z",
      metrics: { views: 100, likes: 0, saves: null },
      additionalMetrics: [{ key: "dislikeCount", value: 1 }],
    });
    expect(requests[2].arguments).toEqual({
      id: ["v1"],
      parts: ["snippet", "statistics", "contentDetails"],
    });
    expect(result.nextCursor).toBe("page_2");
  });
  it("imports TikTok publicly listed videos with millisecond cursor and Unixsecond dates", async () => {
    const { requests } = stub((request) =>
      request.tool_slug === "TIKTOK_GET_USER_STATS"
        ? { user: { follower_count: 0, likes_count: 100 } }
        : request.tool_slug === "TIKTOK_LIST_VIDEOS"
          ? { videos: [{ id: "t1" }], cursor: 1000, has_more: true }
          : {
              videos: [
                {
                  id: "t1",
                  create_time: 0,
                  video_description: "Video",
                  share_url: "https://www.tiktok.com/video/t1",
                  like_count: 0,
                  view_count: 5,
                },
              ],
            },
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "tiktok",
      cursor: "2000",
    });
    expect(requests[1].arguments).toEqual({ max_count: 20, cursor: 2000 });
    expect(result.nextCursor).toBe("1000");
    expect(result.posts[0]).toMatchObject({
      publishedAt: "1970-01-01T00:00:00.000Z",
      metrics: { views: 5, likes: 0 },
    });
  });
  it("explicitly reports LinkedIn personal counters/history unavailable", async () => {
    const { requests } = stub(() => ({ response_dict: { author_id: "123" } }));
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "linkedin",
    });
    expect(result.accountError).toContain("not available");
    expect(result.historyError).toContain("not available");
    expect(result.posts).toEqual([]);
    expect(requests.map((request) => request.tool_slug)).toEqual([
      "LINKEDIN_GET_MY_INFO",
    ]);
  });
  it("rejects malformed or oversized published lists as errors", async () => {
    stub(() => ({
      status: 200,
      data: {
        data: Array.from({ length: 101 }, () => ({
          id: "x",
          author_id: "123",
        })),
      },
    }));
    expect(
      (
        await fetchSocialAccountStatisticsPage({
          ...input,
          includeProfile: false,
        })
      ).historyError,
    ).toContain("unavailable");
  });
  it("folds Facebook daily analytics into labeled window totals without overflowing or inventing zero", async () => {
    stub((request) =>
      request.tool_slug === "FACEBOOK_GET_PAGE_DETAILS"
        ? { id: "123", followers_count: 5, fan_count: 0 }
        : request.tool_slug === "FACEBOOK_GET_PAGE_INSIGHTS"
          ? {
              data: [
                {
                  name: "page_media_view",
                  period: "day",
                  values: [{ value: 0 }, { value: 4 }],
                },
                { name: "missing", values: [] },
                {
                  name: "overflow",
                  values: [{ value: Number.MAX_SAFE_INTEGER }, { value: 1 }],
                },
              ],
            }
          : { status: 200, data: { data: [] } },
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "facebook",
    });
    expect(result.accountMetrics).toContainEqual({
      key: "page_media_view",
      value: 4,
      period: "sum_daily_last_28_days",
      unit: "count",
    });
    expect(result.accountMetrics).toContainEqual({
      key: "missing",
      value: null,
      period: "sum_daily_last_28_days",
      unit: "count",
    });
    expect(result.accountMetrics).toContainEqual({
      key: "overflow",
      value: null,
      period: "sum_daily_last_28_days",
      unit: "count",
    });
  });
  it("retains YouTube decimal/signed analytics and their date window and units", async () => {
    stub((request) =>
      request.tool_slug === "YOUTUBE_LIST_CHANNELS"
        ? {
            items: [
              {
                id: "123",
                snippet: { publishedAt: "2020-01-01T00:00:00Z" },
                statistics: { viewCount: "0", videoCount: "0" },
              },
            ],
          }
        : request.tool_slug === "YOUTUBE_QUERY_ANALYTICS"
          ? {
              columnHeaders: [
                { name: "averageViewDuration" },
                { name: "averageViewPercentage" },
                { name: "subscribersLost" },
              ],
              rows: [[4.5, 33.7, -2]],
            }
          : { items: [] },
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "youtube",
    });
    expect(result.accountMetrics).toContainEqual({
      key: "averageViewDuration",
      value: 4.5,
      period: `2020-01-01/${new Date().toISOString().slice(0, 10)}`,
      unit: "seconds",
    });
    expect(
      result.accountMetrics?.find(
        (item) => item.key === "averageViewPercentage",
      )?.unit,
    ).toBe("percent");
    expect(
      result.accountMetrics?.find((item) => item.key === "subscribersLost")
        ?.value,
    ).toBe(-2);
  });
  it("optional Instagram insights failure preserves the authored page and advances its cursor", async () => {
    stub((request) =>
      request.tool_slug === "INSTAGRAM_GET_IG_USER_MEDIA"
        ? {
            data: [{ id: "ig1", caption: "Available", like_count: 0 }],
            paging: {
              next: "https://provider.test?access_token=secret",
              cursors: { after: "next" },
            },
          }
        : new Error("access denied"),
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "instagram",
      includeProfile: false,
    });
    expect(result.posts[0].metrics.likes).toBe(0);
    expect(result.nextCursor).toBe("next");
    expect(result.metricWarning).toContain("insights");
    expect(result.historyError).toBeNull();
  });
  it("rejects native TikTok error payloads despite successful transport", async () => {
    stub(() => ({
      videos: [],
      has_more: false,
      error: { code: "scope_not_authorized", message: "token=secret" },
    }));
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "tiktok",
      includeProfile: false,
    });
    expect(result.historyError).toContain("unavailable");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it("keeps Instagram Reels watch-time values separate with milliseconds unit", async () => {
    const { requests } = stub((request) =>
      request.tool_slug === "INSTAGRAM_GET_IG_USER_MEDIA"
        ? {
            data: [
              { id: "reel", media_product_type: "REELS", caption: "Reel" },
            ],
          }
        : Array.isArray(request.arguments?.metric) &&
            request.arguments.metric.includes("ig_reels_avg_watch_time")
          ? {
              data: [
                {
                  name: "ig_reels_avg_watch_time",
                  period: "lifetime",
                  values: [{ value: 40.5 }],
                },
              ],
            }
          : {
              data: [
                { name: "views", period: "lifetime", values: [{ value: 0 }] },
              ],
            },
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "instagram",
      includeProfile: false,
    });
    expect(result.posts[0].additionalMetrics).toContainEqual({
      key: "ig_reels_avg_watch_time",
      value: 40.5,
      period: "lifetime",
      unit: "milliseconds",
    });
    expect(result.posts[0].metrics.views).toBe(0);
    expect(requests).toHaveLength(3);
  });
  it("parses current X post fields and repost counters without requiring omitted author metadata", async () => {
    const { requests } = stub(() => ({
      status: 200,
      data: {
        data: [
          {
            id: "current",
            text: "Truncated",
            note_post: { text: "Full post" },
            public_metrics: { repost_count: 4 },
          },
        ],
      },
    }));
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      includeProfile: false,
    });
    expect(requests[0].parameters).toContainEqual({
      name: "post.fields",
      value: "created_at,public_metrics,note_post",
      type: "query",
    });
    expect(result.posts[0]).toMatchObject({
      text: "Full post",
      metrics: { shares: 4 },
    });
  });
  it("retries only a trusted X host alias on Composio domain rejection and preserves account/query", async () => {
    const { requests } = stub((request) =>
      request.endpoint?.startsWith("https://api.x.com/")
        ? new Response(
            JSON.stringify({
              error: {
                message:
                  "Endpoint domain does not match connected toolkit domain",
              },
            }),
            { status: 400 },
          )
        : { status: 200, data: { data: [] } },
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      includeProfile: false,
      cursor: "opaque/token==",
    });
    expect(result.historyError).toBeNull();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({
      ...requests[0],
      endpoint: "https://api.twitter.com/2/users/123/tweets",
    });
    expect(requests[1].parameters).toContainEqual({
      name: "pagination_token",
      type: "query",
      value: "opaque/token==",
    });
  });
  it("does not retry another X host on upstream authentication failure", async () => {
    const { requests } = stub(
      () =>
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
        }),
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      includeProfile: false,
    });
    expect(result.historyError).toContain("unavailable");
    expect(requests).toHaveLength(1);
  });
  it("names X liked-post activity separately from received performance likes", async () => {
    stub((request) =>
      request.tool_slug
        ? { id: "123", public_metrics: { like_count: 7 } }
        : { status: 200, data: { data: [] } },
    );
    const result = await fetchSocialAccountStatisticsPage(input);
    expect(result.accountMetrics).toContainEqual({
      key: "posts_liked_count",
      value: 7,
      period: "lifetime",
      unit: "count",
    });
    expect(
      result.accountMetrics?.some((item) => item.key === "like_count"),
    ).toBe(false);
  });
  it("preserves YouTube listed videos and progress when optional detail batch fails, using actual publish date only", async () => {
    stub((request) =>
      request.tool_slug === "YOUTUBE_LIST_CHANNEL_VIDEOS"
        ? {
            items: [
              {
                snippet: {
                  title: "Listed video",
                  publishedAt: "2026-01-01T00:00:00Z",
                  resourceId: { videoId: "v1" },
                },
                contentDetails: { videoPublishedAt: "2020-01-01T00:00:00Z" },
              },
              {
                snippet: {
                  title: "Date unavailable",
                  publishedAt: "2026-01-01T00:00:00Z",
                  resourceId: { videoId: "v2" },
                },
              },
            ],
            nextPageToken: "next/page==",
          }
        : new Error("details denied"),
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "youtube",
      includeProfile: false,
    });
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0]).toMatchObject({
      externalId: "v1",
      text: "Listed video",
      publishedAt: "2020-01-01T00:00:00.000Z",
      metrics: { views: null },
    });
    expect(result.posts[1].publishedAt).toBeNull();
    expect(result.nextCursor).toBe("next/page==");
    expect(result.historyError).toBeNull();
    expect(result.metricWarning).toContain("details");
  });
  it("preserves TikTok listed metadata, counters and cursor when optional detail batch fails", async () => {
    stub((request) =>
      request.tool_slug === "TIKTOK_LIST_VIDEOS"
        ? {
            videos: [
              {
                id: "t1",
                video_description: "Listed",
                create_time: 0,
                share_url: "https://www.tiktok.com/video/t1",
                view_count: 0,
              },
            ],
            has_more: true,
            cursor: 1000,
          }
        : new Error("details denied"),
    );
    const result = await fetchSocialAccountStatisticsPage({
      ...input,
      provider: "tiktok",
      includeProfile: false,
    });
    expect(result.posts[0]).toMatchObject({
      text: "Listed",
      publishedAt: "1970-01-01T00:00:00.000Z",
      metrics: { views: 0, likes: null },
    });
    expect(result.nextCursor).toBe("1000");
    expect(result.historyError).toBeNull();
    expect(result.metricWarning).toContain("details");
  });
});
