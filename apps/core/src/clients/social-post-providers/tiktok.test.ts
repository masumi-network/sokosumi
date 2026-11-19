import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishTikTokVideo } from "@/clients/social-post-providers/tiktok";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/social-post-providers/tools";

import { getZernioTikTokCreatorInfo } from "@/clients/social-post-providers/zernio-tiktok";
import { zernioRequest } from "@/clients/zernio.client";

vi.mock("@/clients/zernio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/zernio.client")>()),
  zernioRequest: vi.fn(),
}));

const { getEnvMock, logSetMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  logSetMock: vi.fn(),
}));

// The real recorders keep their events at the drain seam.
vi.mock("@/lib/evlog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/evlog")>()),
  tryUseLogger: () => ({ set: logSetMock }),
}));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(async () => undefined),
}));

const context = {
  provider: "tiktok" as const,
  connectedAccountId: "ca_tt",
  executorUserId: "sokosumi:project-executor:project_123",
  externalAccountId: "open_id_1",
  externalHandle: "alice",
  text: "Hello TikTok",
  tikTokSettings: {
    privacyLevel: "SELF_ONLY" as const,
    acceptedMusicUsage: true as const,
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    promotesOwnBrand: false,
  },
  media: [
    {
      pathname: "drive/users/user_1/clip.mp4",
      fileUrl:
        "https://store.public.blob.vercel-storage.com/drive/users/user_1/clip.mp4",
      name: "clip.mp4",
      size: 3,
      mimeType: "video/mp4",
      kind: "video" as const,
    },
  ],
};

interface ExecuteCall {
  tool_slug: string;
  arguments: Record<string, unknown>;
}

function stubSession(execute: (call: ExecuteCall) => Response) {
  const fetchMock = vi.fn(
    async (url: URL, init?: RequestInit): Promise<Response> => {
      if (url.pathname === "/api/v3.1/tool_router/session") {
        return Response.json({ session_id: "sess_tt" });
      }
      if (url.pathname.endsWith("/execute")) {
        return execute(JSON.parse(String(init?.body)));
      }
      if (init?.method === "DELETE") return Response.json({});
      throw new Error(`Unexpected path ${url.pathname}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function toolResponse(data: unknown): Response {
  return Response.json({
    data: { data: { data, error: { code: "ok", message: "" } } },
    error: null,
    successful: true,
  });
}

function executeCalls(
  fetchMock: ReturnType<typeof stubSession>,
): ExecuteCall[] {
  return fetchMock.mock.calls
    .filter(([url]) => url.pathname.endsWith("/execute"))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

describe("publishTikTokVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("refuses an unavailable choice and never sends a publish request", async () => {
    const calls = stubSession(() =>
      toolResponse({ privacy_level_options: ["PUBLIC_TO_EVERYONE"] }),
    );
    await expect(publishTikTokVideo(context)).rejects.toThrow(
      "Choose an available TikTok audience",
    );
    expect(executeCalls(calls).map((call) => call.tool_slug)).toEqual([
      "TIKTOK_QUERY_CREATOR_INFO",
    ]);
  });
  it("publishes with the selected private audience and waits for completion", async () => {
    const fetchMock = stubSession((call) => {
      if (call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO") {
        return toolResponse({
          privacy_level_options: ["FOLLOWER_OF_CREATOR", "SELF_ONLY"],
        });
      }
      if (call.tool_slug === "TIKTOK_PUBLISH_VIDEO") {
        return toolResponse({ publish_id: "pub_1" });
      }
      if (call.arguments.publish_id === "pub_1") {
        return toolResponse({
          status: "PUBLISH_COMPLETE",
          publicaly_available_post_id: ["751234567890"],
        });
      }
      return toolResponse({ status: "PROCESSING_UPLOAD" });
    });

    await expect(publishTikTokVideo(context)).resolves.toEqual({
      externalId: "751234567890",
      publishedUrl: null,
      providerOutcome: "published (SELF_ONLY)",
      toolSlug: "TIKTOK_PUBLISH_VIDEO",
    });
    expect(executeCalls(fetchMock)[1]).toEqual({
      tool_slug: "TIKTOK_PUBLISH_VIDEO",
      arguments: {
        video_url: context.media[0].fileUrl,
        caption: "Hello TikTok",
        privacy_level: "SELF_ONLY",
        disable_comment: true,
        disable_duet: true,
        disable_stitch: true,
        brand_organic_toggle: false,
      },
    });
    expect(
      executeCalls(fetchMock)
        .filter((call) => call.tool_slug === "TIKTOK_FETCH_PUBLISH_STATUS")
        .map((call) => call.arguments),
    ).toEqual([{ publish_id: "pub_1" }]);
  });

  it("labels an AI-generated video for TikTok", async () => {
    const fetchMock = stubSession((call) => {
      if (call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO") {
        return toolResponse({ privacy_level_options: ["SELF_ONLY"] });
      }
      if (call.tool_slug === "TIKTOK_PUBLISH_VIDEO") {
        return toolResponse({ publish_id: "pub_ai" });
      }
      return toolResponse({
        status: "PUBLISH_COMPLETE",
        publicaly_available_post_id: ["751234567891"],
      });
    });

    await publishTikTokVideo({ ...context, aiGenerated: true });

    expect(executeCalls(fetchMock)[1]?.arguments).toMatchObject({
      is_aigc: true,
    });
  });

  it("labels a video whose media ref is marked AI-made", async () => {
    const fetchMock = stubSession((call) => {
      if (call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO") {
        return toolResponse({ privacy_level_options: ["SELF_ONLY"] });
      }
      if (call.tool_slug === "TIKTOK_PUBLISH_VIDEO") {
        return toolResponse({ publish_id: "pub_ai" });
      }
      return toolResponse({
        status: "PUBLISH_COMPLETE",
        publicaly_available_post_id: ["751234567891"],
      });
    });

    await publishTikTokVideo({
      ...context,
      media: [{ ...context.media[0], aiGenerated: true }],
    });

    expect(executeCalls(fetchMock)[1]?.arguments).toMatchObject({
      is_aigc: true,
    });
  });

  it("stores the publish id when completion has no queryable video id", async () => {
    stubSession((call) => {
      if (call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO") {
        return toolResponse({ privacy_level_options: ["SELF_ONLY"] });
      }
      if (call.tool_slug === "TIKTOK_PUBLISH_VIDEO") {
        return toolResponse({ publish_id: "v_pub_9" });
      }
      return toolResponse({
        status: "PUBLISH_COMPLETE",
        publicaly_available_post_id: ["video_9"],
      });
    });

    await expect(publishTikTokVideo(context)).resolves.toMatchObject({
      externalId: "v_pub_9",
    });
  });

  it("keeps polling through non-terminal statuses", async () => {
    let statusCalls = 0;
    const fetchMock = stubSession((call) => {
      if (call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO") {
        return toolResponse({ privacy_level_options: ["SELF_ONLY"] });
      }
      if (call.tool_slug === "TIKTOK_PUBLISH_VIDEO") {
        return toolResponse({ publish_id: "pub_2" });
      }
      statusCalls += 1;
      return statusCalls < 2
        ? toolResponse({ status: "PROCESSING_DOWNLOAD" })
        : toolResponse({ status: "PUBLISH_COMPLETE" });
    });

    await publishTikTokVideo(context);

    expect(
      executeCalls(fetchMock).filter(
        (call) => call.tool_slug === "TIKTOK_FETCH_PUBLISH_STATUS",
      ),
    ).toHaveLength(2);
  });

  it("fails permanently when the status reports FAILED", async () => {
    stubSession((call) => {
      if (call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO") {
        return toolResponse({ privacy_level_options: ["SELF_ONLY"] });
      }
      if (call.tool_slug === "TIKTOK_PUBLISH_VIDEO") {
        return toolResponse({ publish_id: "pub_3" });
      }
      return toolResponse({ status: "FAILED", fail_reason: "video too long" });
    });

    await expect(publishTikTokVideo(context)).rejects.toMatchObject({
      constructor: ComposioToolError,
      message: "TikTok refused the video",
      providerMessage: "video too long",
    });
  });

  it("marks the outcome unknown when polling is aborted after the publish call", async () => {
    const controller = new AbortController();
    stubSession((call) => {
      if (call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO") {
        return toolResponse({ privacy_level_options: ["SELF_ONLY"] });
      }
      if (call.tool_slug === "TIKTOK_PUBLISH_VIDEO") {
        queueMicrotask(() => controller.abort());
        return toolResponse({ publish_id: "pub_4" });
      }
      return toolResponse({ status: "PROCESSING_UPLOAD" });
    });

    const { ComposioPublishOutcomeUnknownError } = await import(
      "@/clients/social-post-providers/tools"
    );
    await expect(
      publishTikTokVideo({ ...context, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ComposioPublishOutcomeUnknownError);
  });

  it("marks the outcome unknown when the publish call times out upstream", async () => {
    stubSession((call) =>
      call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO"
        ? toolResponse({ privacy_level_options: ["SELF_ONLY"] })
        : new Response("unavailable", { status: 503 }),
    );

    const { ComposioPublishOutcomeUnknownError } = await import(
      "@/clients/social-post-providers/tools"
    );
    await expect(publishTikTokVideo(context)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
  });

  // The video is already with TikTok once the publish call returns an id, so a
  // status-check error — even a transient 429 — must not read as retryable:
  // a retry would post the video a second time.
  it("marks the outcome unknown when a status check errors after the publish call", async () => {
    stubSession((call) => {
      if (call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO") {
        return toolResponse({ privacy_level_options: ["SELF_ONLY"] });
      }
      if (call.tool_slug === "TIKTOK_PUBLISH_VIDEO") {
        return toolResponse({ publish_id: "pub_5" });
      }
      return Response.json({
        data: null,
        error: { message: "rate limited, try again later", status: 429 },
        successful: false,
      });
    });

    const { ComposioPublishOutcomeUnknownError } = await import(
      "@/clients/social-post-providers/tools"
    );
    await expect(publishTikTokVideo(context)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
  });

  it("refuses before opening a session when there is no video", async () => {
    const fetchMock = stubSession(() => toolResponse({}));

    await expect(
      publishTikTokVideo({ ...context, media: [] }),
    ).rejects.toMatchObject({
      constructor: ComposioToolError,
      message: "TikTok requires a video",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("raises a tool error when the publish call is refused", async () => {
    stubSession((call) =>
      call.tool_slug === "TIKTOK_QUERY_CREATOR_INFO"
        ? toolResponse({ privacy_level_options: ["SELF_ONLY"] })
        : Response.json({
            data: null,
            error: { message: "unaudited app", status: 403 },
            successful: false,
          }),
    );

    await expect(publishTikTokVideo(context)).rejects.toMatchObject({
      constructor: ComposioToolError,
      message: "TikTok refused the video",
      providerMessage: "unaudited app",
      providerStatus: 403,
    });
  });
});

describe("TikTok through Zernio", () => {
  const info = {
    creator: { nickname: "Alice", canPostMore: true },
    privacyLevels: [{ value: "SELF_ONLY" }, { value: "PUBLIC_TO_EVERYONE" }],
    postingLimits: {
      maxVideoDurationSec: 120,
      interactionSettings: {
        allow_comment: { enabled: true },
        allow_duet: { enabled: false },
        allow_stitch: { enabled: true },
      },
    },
  };
  const input = {
    ...context,
    postId: "post-123",
    connectedAccountId: "zernio:alpha",
    tikTokSettings: {
      ...context.tikTokSettings,
      privacyLevel: "PUBLIC_TO_EVERYONE" as const,
      previewConsent: true as const,
      allowComment: true,
      allowDuet: true,
      promotesOwnBrand: true,
    },
  };
  function result(status: string) {
    return {
      post: {
        _id: "zpost",
        platforms: [
          {
            platform: "tiktok",
            status,
            platformPostId: "7543333333333333333",
            platformPostUrl: null,
          },
        ],
      },
    };
  }

  beforeEach(() => {
    vi.mocked(zernioRequest).mockReset().mockResolvedValueOnce(info);
  });

  it("maps video limits and exposes only a supported Business app audience", async () => {
    await expect(getZernioTikTokCreatorInfo("alpha")).resolves.toEqual({
      creator_nickname: "Alice",
      privacy_level_options: ["PUBLIC_TO_EVERYONE"],
      comment_disabled: false,
      duet_disabled: true,
      stitch_disabled: false,
      max_video_post_duration_sec: 120,
    });
    expect(zernioRequest).toHaveBeenCalledWith(
      "/accounts/alpha/tiktok/creator-info?mediaType=video",
      { signal: undefined },
    );
  });

  it("requires express permission and preview confirmation before creating a post", async () => {
    await expect(
      publishTikTokVideo({
        ...input,
        tikTokSettings: { ...input.tikTokSettings, previewConsent: undefined },
      }),
    ).rejects.toThrow("Confirm the TikTok video preview");
    expect(zernioRequest).toHaveBeenCalledTimes(1);
  });

  it("never upgrades an explicitly private choice to public", async () => {
    await expect(
      publishTikTokVideo({ ...input, tikTokSettings: context.tikTokSettings }),
    ).rejects.toThrow("Choose an available TikTok audience");
    expect(zernioRequest).toHaveBeenCalledTimes(1);
  });

  it("rechecks creator limits and submits the confirmed settings once, with a stable key", async () => {
    vi.mocked(zernioRequest)
      .mockResolvedValueOnce(result("processing"))
      .mockResolvedValueOnce(result("published"));
    await expect(
      publishTikTokVideo({
        ...input,
        media: [{ ...input.media[0], aiGenerated: true }],
      }),
    ).resolves.toMatchObject({
      externalId: "zpost",
      publishedUrl: null,
      toolSlug: "ZERNIO_TIKTOK_CREATE_POST",
    });
    expect(zernioRequest).toHaveBeenNthCalledWith(2, "/posts", {
      method: "POST",
      idempotencyKey: input.postId,
      signal: undefined,
      body: {
        content: context.text,
        mediaItems: [{ type: "video", url: context.media[0].fileUrl }],
        platforms: [{ platform: "tiktok", accountId: "alpha" }],
        publishNow: true,
        tiktokSettings: {
          videoMadeWithAi: true,
          privacy_level: "PUBLIC_TO_EVERYONE",
          allow_comment: true,
          allow_duet: false,
          allow_stitch: false,
          commercial_content_type: "brand_organic",
          content_preview_confirmed: true,
          express_consent_given: true,
        },
      },
    });
    expect(zernioRequest).toHaveBeenNthCalledWith(3, "/posts/zpost", {
      signal: undefined,
    });
  });

  it("labels a talking video Core recognised, whose media ref carries no mark", async () => {
    vi.mocked(zernioRequest).mockResolvedValueOnce(result("published"));
    await publishTikTokVideo({ ...input, aiGenerated: true });
    expect(zernioRequest).toHaveBeenNthCalledWith(
      2,
      "/posts",
      expect.objectContaining({
        body: expect.objectContaining({
          tiktokSettings: expect.objectContaining({ videoMadeWithAi: true }),
        }),
      }),
    );
  });

  it("treats a failure within an HTTP success as a provider refusal", async () => {
    vi.mocked(zernioRequest).mockResolvedValueOnce(result("failed"));
    await expect(publishTikTokVideo(input)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
  });

  it("does not attribute a replayed post to a different account", async () => {
    vi.mocked(zernioRequest).mockResolvedValueOnce({
      post: {
        _id: "zpost",
        platforms: [
          {
            platform: "tiktok",
            status: "published",
            accountId: { _id: "previous-account" },
          },
        ],
      },
    });
    await expect(publishTikTokVideo(input)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
  });

  it("preserves an unknown outcome when the create response is lost", async () => {
    vi.mocked(zernioRequest).mockRejectedValueOnce(
      new Error("connection lost"),
    );
    await expect(publishTikTokVideo(input)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
    expect(zernioRequest).toHaveBeenCalledTimes(2);
  });
});
