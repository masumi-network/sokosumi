import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchSocialPostStatistics,
  type SocialPostStatisticsContext,
  SocialPostStatisticsUnavailableError,
} from "@/clients/social-post-providers/statistics";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => null }));

const input: SocialPostStatisticsContext = {
  provider: "x",
  connectedAccountId: "ca_1",
  executorUserId: "executor",
  externalAccountId: "account",
  externalId: "123",
};
const unavailable = {
  views: null,
  impressions: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
};

function stubSession(respond: (slug: string) => unknown) {
  const executeCalls: { tool_slug: string; arguments: unknown }[] = [];
  const sessions: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (url: URL, init?: RequestInit) => {
    if (url.pathname.endsWith("/execute")) {
      const request = JSON.parse(String(init?.body));
      executeCalls.push(request);
      const payload = respond(request.tool_slug);
      if (payload instanceof Error) throw payload;
      return new Response(JSON.stringify(payload));
    }
    if (init?.method === "DELETE") return new Response("{}");
    sessions.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ session_id: "sess_test" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, executeCalls, sessions };
}

function toolResult(payload: unknown) {
  return { data: { data: payload }, successful: true };
}

beforeEach(() => {
  getEnvMock.mockReturnValue({ COMPOSIO_API_KEY: "test-key" });
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchSocialPostStatistics", () => {
  it("pins an X read session and preserves zero while leaving omitted counters unknown", async () => {
    const { sessions, executeCalls, fetchMock } = stubSession(() =>
      toolResult({
        data: {
          id: "123",
          public_metrics: {
            impression_count: 42,
            like_count: 0,
            reply_count: 2,
            organic_repost_count: 4,
            retweet_count: 3,
          },
        },
      }),
    );
    await expect(fetchSocialPostStatistics(input)).resolves.toEqual({
      ...unavailable,
      impressions: 42,
      likes: 0,
      comments: 2,
      shares: 4,
    });
    expect(sessions[0]).toMatchObject({
      user_id: "executor",
      connected_accounts: { twitter: ["ca_1"] },
      tools: { twitter: { enable: ["TWITTER_POST_LOOKUP_BY_POST_ID"] } },
      manage_connections: { enable: false, enable_connection_removal: false },
      workbench: { enable: false, enable_proxy_execution: false },
    });
    expect(executeCalls).toEqual([
      {
        tool_slug: "TWITTER_POST_LOOKUP_BY_POST_ID",
        arguments: {
          id: "123",
          tweet_fields: ["public_metrics"],
        },
      },
    ]);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("reads Instagram lifetime values and total values without requesting deprecated impressions", async () => {
    const { executeCalls } = stubSession(() =>
      toolResult({
        data: [
          { name: "views", values: [{ value: 50 }] },
          { name: "likes", values: [{ value: 0 }] },
          { name: "saved", total_value: { value: 4 } },
          { name: "shares", values: [] },
        ],
      }),
    );
    await expect(
      fetchSocialPostStatistics({ ...input, provider: "instagram" }),
    ).resolves.toEqual({
      ...unavailable,
      views: 50,
      likes: 0,
      saves: 4,
    });
    expect(executeCalls[0]).toEqual({
      tool_slug: "INSTAGRAM_GET_IG_MEDIA_INSIGHTS",
      arguments: {
        ig_media_id: "123",
        metric: ["views", "likes", "comments", "shares", "saved"],
        period: "lifetime",
      },
    });
  });

  it("reads Facebook reaction summaries and only current media view insights", async () => {
    const { executeCalls } = stubSession((slug) =>
      toolResult(
        slug === "FACEBOOK_GET_POST"
          ? {
              id: "123",
              reactions: { summary: { total_count: 5 } },
              comments: { summary: { total_count: 0 } },
              shares: { count: 2 },
            }
          : { data: [{ name: "post_media_view", values: [{ value: 20 }] }] },
      ),
    );
    await expect(
      fetchSocialPostStatistics({ ...input, provider: "facebook" }),
    ).resolves.toEqual({
      ...unavailable,
      views: 20,
      likes: 5,
      comments: 0,
      shares: 2,
    });
    expect(executeCalls[1]).toEqual({
      tool_slug: "FACEBOOK_GET_POST_INSIGHTS",
      arguments: {
        post_id: "123",
        metrics: "post_media_view,post_activity_by_action_type",
        period: "lifetime",
      },
    });
  });

  it("prefers Facebook insight shares over a Graph shares.count of zero", async () => {
    stubSession((slug) =>
      toolResult(
        slug === "FACEBOOK_GET_POST"
          ? {
              id: "123",
              reactions: { summary: { total_count: 2 } },
              shares: { count: 0 },
            }
          : {
              data: [
                {
                  name: "post_activity_by_action_type",
                  total_value: { value: { share: 6 } },
                },
              ],
            },
      ),
    );
    await expect(
      fetchSocialPostStatistics({
        ...input,
        provider: "facebook",
      }),
    ).resolves.toMatchObject({ shares: 6, likes: 2 });
  });

  it("keeps available Facebook engagement when insight permission is missing", async () => {
    stubSession((slug) =>
      slug === "FACEBOOK_GET_POST"
        ? toolResult({ reactions: { summary: { total_count: 0 } } })
        : {
            successful: false,
            error: { message: "Missing insight permission", status: 403 },
          },
    );
    await expect(
      fetchSocialPostStatistics({ ...input, provider: "facebook" }),
    ).resolves.toEqual({ ...unavailable, likes: 0 });
  });

  it.each([
    new Error("transport timeout"),
    { successful: false, error: { message: "Rate limited", status: 429 } },
    { successful: false, error: "Unknown provider failure" },
  ])(
    "fails the whole Facebook refresh on transient or unknown insight error %s",
    async (failure) => {
      const { fetchMock } = stubSession((slug) =>
        slug === "FACEBOOK_GET_POST"
          ? toolResult({ reactions: { summary: { total_count: 5 } } })
          : failure,
      );
      await expect(
        fetchSocialPostStatistics({ ...input, provider: "facebook" }),
      ).rejects.toBeInstanceOf(SocialPostStatisticsUnavailableError);
      expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    },
  );

  it("parses YouTube decimal counters for the matching video and leaves deprecated favorites unknown", async () => {
    const { executeCalls } = stubSession(() =>
      toolResult({
        items: [
          { id: "other", statistics: { viewCount: "999" } },
          {
            id: "123",
            statistics: {
              viewCount: "100",
              likeCount: "0",
              commentCount: "5",
              favoriteCount: "0",
            },
          },
        ],
      }),
    );
    await expect(
      fetchSocialPostStatistics({ ...input, provider: "youtube" }),
    ).resolves.toEqual({
      ...unavailable,
      views: 100,
      likes: 0,
      comments: 5,
    });
    expect(executeCalls[0]).toEqual({
      tool_slug: "YOUTUBE_GET_VIDEO_DETAILS_BATCH",
      arguments: { id: ["123"], parts: ["statistics"] },
    });
  });

  it("reads TikTok returned engagement counts for the exact published video", async () => {
    const { executeCalls } = stubSession(() =>
      toolResult({
        videos: [
          {
            id: "123",
            view_count: 100,
            like_count: 3,
            comment_count: 2,
            share_count: 0,
          },
        ],
      }),
    );
    await expect(
      fetchSocialPostStatistics({ ...input, provider: "tiktok" }),
    ).resolves.toEqual({
      ...unavailable,
      views: 100,
      likes: 3,
      comments: 2,
      shares: 0,
    });
    expect(executeCalls[0]).toEqual({
      tool_slug: "TIKTOK_QUERY_VIDEOS",
      arguments: { video_ids: ["123"] },
    });
  });

  it.each([
    null,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    "",
    "1e3",
    "-1",
    "9007199254740992",
    true,
  ])("does not turn invalid count %s into a zero", async (value) => {
    stubSession(() =>
      toolResult({ public_metrics: { like_count: value, reply_count: 0 } }),
    );
    await expect(fetchSocialPostStatistics(input)).resolves.toEqual({
      ...unavailable,
      comments: 0,
    });
  });

  it.each([null, {}, { items: [] }, { public_metrics: {} }])(
    "rejects missing metrics %s",
    async (payload) => {
      stubSession(() => toolResult(payload));
      await expect(fetchSocialPostStatistics(input)).rejects.toBeInstanceOf(
        SocialPostStatisticsUnavailableError,
      );
    },
  );

  it("sanitizes provider and transport failures and deletes the session", async () => {
    const { fetchMock } = stubSession(() => ({
      successful: false,
      error: "access_token=private-secret https://internal.example",
    }));
    await expect(fetchSocialPostStatistics(input)).rejects.toThrow(
      "X statistics are unavailable. Check the connection permissions or try again later.",
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("sanitizes transport failures after session creation", async () => {
    const { fetchMock } = stubSession(
      () => new Error("api_key=private-secret"),
    );
    await expect(fetchSocialPostStatistics(input)).rejects.toThrow(
      "X statistics are unavailable. Check the connection permissions or try again later.",
    );
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("sanitizes failures while creating the restricted session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret", { status: 403 })),
    );
    await expect(fetchSocialPostStatistics(input)).rejects.toBeInstanceOf(
      SocialPostStatisticsUnavailableError,
    );
  });

  it("propagates cancellation while cleaning up the restricted session", async () => {
    const controller = new AbortController();
    const { fetchMock } = stubSession(() => {
      controller.abort();
      return new Error("cancelled");
    });
    await expect(
      fetchSocialPostStatistics({ ...input, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("rejects unsupported personal LinkedIn and unresolved TikTok publish IDs without a session", async () => {
    const { fetchMock } = stubSession(() => null);
    await expect(
      fetchSocialPostStatistics({ ...input, provider: "linkedin" }),
    ).rejects.toThrow("LinkedIn personal post statistics");
    await expect(
      fetchSocialPostStatistics({
        ...input,
        provider: "tiktok",
        externalId: "v_pub_123",
      }),
    ).rejects.toThrow("published video ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
