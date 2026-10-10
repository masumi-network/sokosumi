import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  pickTikTokPrivacyLevel,
  publishTikTokVideo,
} from "@/clients/social-post-providers/tiktok";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const { getEnvMock, logSetMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  logSetMock: vi.fn(),
}));

vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => ({ set: logSetMock }) }));
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
  return Response.json({ data: { data }, error: null, successful: true });
}

function executeCalls(
  fetchMock: ReturnType<typeof stubSession>,
): ExecuteCall[] {
  return fetchMock.mock.calls
    .filter(([url]) => url.pathname.endsWith("/execute"))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

describe("pickTikTokPrivacyLevel", () => {
  it.each([
    [["SELF_ONLY"], "SELF_ONLY"],
    [
      [
        "PUBLIC_TO_EVERYONE",
        "MUTUAL_FOLLOW_FRIENDS",
        "FOLLOWER_OF_CREATOR",
        "SELF_ONLY",
      ],
      "PUBLIC_TO_EVERYONE",
    ],
    [["MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR"], "MUTUAL_FOLLOW_FRIENDS"],
    [["FOLLOWER_OF_CREATOR", "SELF_ONLY"], "FOLLOWER_OF_CREATOR"],
    [[], "SELF_ONLY"],
  ] as const)("picks %s as %s", (available, expected) => {
    expect(pickTikTokPrivacyLevel(available)).toBe(expected);
  });
});

describe("publishTikTokVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("publishes with the most permissive level and waits for completion", async () => {
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
      providerOutcome: "published (FOLLOWER_OF_CREATOR)",
      toolSlug: "TIKTOK_PUBLISH_VIDEO",
    });
    expect(executeCalls(fetchMock)[1]).toEqual({
      tool_slug: "TIKTOK_PUBLISH_VIDEO",
      arguments: {
        video_url: context.media[0].fileUrl,
        caption: "Hello TikTok",
        privacy_level: "FOLLOWER_OF_CREATOR",
      },
    });
    expect(
      executeCalls(fetchMock)
        .filter((call) => call.tool_slug === "TIKTOK_FETCH_PUBLISH_STATUS")
        .map((call) => call.arguments),
    ).toEqual([{ publish_id: "pub_1" }]);
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
