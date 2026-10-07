import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishInstagramPost } from "@/clients/social-post-providers/instagram";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const { getEnvMock, logSetMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  logSetMock: vi.fn(),
}));

vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => ({ set: logSetMock }) }));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));

const context = {
  provider: "instagram" as const,
  connectedAccountId: "ca_ig",
  executorUserId: "sokosumi:project-executor:project_123",
  externalAccountId: "17841400000000000",
  externalHandle: "alice",
  text: "Hello Instagram",
  media: [],
};

const IMAGE_REF = {
  pathname: "drive/users/user_1/photo.jpg",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/photo.jpg",
  name: "photo.jpg",
  size: 3,
  mimeType: "image/jpeg",
  kind: "image" as const,
};

const VIDEO_REF = {
  pathname: "drive/users/user_1/clip.mp4",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/clip.mp4",
  name: "clip.mp4",
  size: 3,
  mimeType: "video/mp4",
  kind: "video" as const,
};

interface ExecuteCall {
  tool_slug: string;
  arguments: Record<string, unknown>;
}

function stubSession(execute: (call: ExecuteCall) => Response) {
  const fetchMock = vi.fn(
    async (url: URL, init?: RequestInit): Promise<Response> => {
      if (url.pathname === "/api/v3.1/tool_router/session") {
        return Response.json({ session_id: "sess_ig" });
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

describe("publishInstagramPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("creates an image container and publishes it", async () => {
    const fetchMock = stubSession((call) =>
      call.tool_slug === "INSTAGRAM_POST_IG_USER_MEDIA"
        ? toolResponse({ id: "container_1" })
        : toolResponse({ id: "media_77" }),
    );

    await expect(
      publishInstagramPost({ ...context, media: [IMAGE_REF] }),
    ).resolves.toEqual({
      externalId: "media_77",
      publishedUrl: null,
      toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
    });
    expect(executeCalls(fetchMock)).toEqual([
      {
        tool_slug: "INSTAGRAM_POST_IG_USER_MEDIA",
        arguments: {
          ig_user_id: "17841400000000000",
          caption: "Hello Instagram",
          image_url: IMAGE_REF.fileUrl,
        },
      },
      {
        tool_slug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
        arguments: {
          ig_user_id: "17841400000000000",
          creation_id: "container_1",
          max_wait_seconds: 180,
        },
      },
    ]);
  });

  it("uses the video URL for a Reel container", async () => {
    const fetchMock = stubSession((call) =>
      call.tool_slug === "INSTAGRAM_POST_IG_USER_MEDIA"
        ? toolResponse({ creation_id: "container_2" })
        : toolResponse({ id: "media_78" }),
    );

    await publishInstagramPost({ ...context, media: [VIDEO_REF] });

    expect(executeCalls(fetchMock)[0]).toEqual({
      tool_slug: "INSTAGRAM_POST_IG_USER_MEDIA",
      arguments: {
        ig_user_id: "17841400000000000",
        caption: "Hello Instagram",
        video_url: VIDEO_REF.fileUrl,
      },
    });
  });

  it("omits the caption when the post has no text", async () => {
    const fetchMock = stubSession((call) =>
      call.tool_slug === "INSTAGRAM_POST_IG_USER_MEDIA"
        ? toolResponse({ id: "container_3" })
        : toolResponse({ id: "media_79" }),
    );

    await publishInstagramPost({ ...context, text: "", media: [IMAGE_REF] });

    expect(executeCalls(fetchMock)[0]?.arguments).toEqual({
      ig_user_id: "17841400000000000",
      image_url: IMAGE_REF.fileUrl,
    });
  });

  it("raises a tool error when the container is refused", async () => {
    stubSession(() =>
      Response.json({
        data: null,
        error: { message: "Invalid image aspect ratio", status: 400 },
        successful: false,
      }),
    );

    await expect(
      publishInstagramPost({ ...context, media: [IMAGE_REF] }),
    ).rejects.toMatchObject({
      constructor: ComposioToolError,
      message: "Instagram refused the media",
      providerMessage: "Invalid image aspect ratio",
      providerStatus: 400,
    });
  });
});
