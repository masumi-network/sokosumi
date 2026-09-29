import { beforeEach, describe, expect, it, vi } from "vitest";

import { publishFacebookPost } from "@/clients/social-post-providers/facebook";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

const { getEnvMock, logSetMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  logSetMock: vi.fn(),
}));

vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => ({ set: logSetMock }) }));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));

const context = {
  provider: "facebook" as const,
  connectedAccountId: "ca_fb",
  executorUserId: "sokosumi:project-executor:project_123",
  externalAccountId: "page_123",
  externalHandle: "Alice Studio",
  text: "Hello Facebook",
  media: [],
};

const IMAGE_REF = {
  pathname: "drive/users/user_1/photo.png",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/photo.png",
  name: "photo.png",
  size: 3,
  mimeType: "image/png",
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
        return Response.json({ session_id: "sess_fb" });
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

describe("publishFacebookPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("publishes a text post to the connected Page", async () => {
    const fetchMock = stubSession(() =>
      toolResponse({ id: "page_123_post_9", permalink_url: null }),
    );

    await expect(publishFacebookPost(context)).resolves.toEqual({
      externalId: "page_123_post_9",
      publishedUrl: "https://www.facebook.com/page_123_post_9",
      toolSlug: "FACEBOOK_CREATE_POST",
    });
    expect(executeCalls(fetchMock)).toEqual([
      {
        tool_slug: "FACEBOOK_CREATE_POST",
        arguments: {
          page_id: "page_123",
          message: "Hello Facebook",
          published: true,
        },
      },
    ]);
  });

  it("prefers the permalink the provider returned", async () => {
    stubSession(() =>
      toolResponse({
        id: "page_123_post_9",
        permalink_url: "https://www.facebook.com/permalink/9",
      }),
    );

    await expect(publishFacebookPost(context)).resolves.toMatchObject({
      publishedUrl: "https://www.facebook.com/permalink/9",
    });
  });

  it("publishes one image as a photo post", async () => {
    const fetchMock = stubSession(() =>
      toolResponse({ id: "page_123_post_10" }),
    );

    await publishFacebookPost({ ...context, media: [IMAGE_REF] });

    expect(executeCalls(fetchMock)).toEqual([
      {
        tool_slug: "FACEBOOK_CREATE_PHOTO_POST",
        arguments: {
          page_id: "page_123",
          url: IMAGE_REF.fileUrl,
          message: "Hello Facebook",
          published: true,
        },
      },
    ]);
  });

  it("publishes two images as a multi-photo post", async () => {
    const fetchMock = stubSession(() =>
      toolResponse({ id: "page_123_post_11" }),
    );
    const second = {
      ...IMAGE_REF,
      pathname: "drive/users/user_1/second.png",
      fileUrl: IMAGE_REF.fileUrl.replace("photo.png", "second.png"),
      name: "second.png",
    };

    await publishFacebookPost({
      ...context,
      media: [IMAGE_REF, second],
    });

    expect(executeCalls(fetchMock)).toEqual([
      {
        tool_slug: "FACEBOOK_CREATE_MULTI_PHOTO_POST",
        arguments: {
          page_id: "page_123",
          photo_urls: [IMAGE_REF.fileUrl, second.fileUrl],
          message: "Hello Facebook",
        },
      },
    ]);
  });

  it("publishes a video by URL", async () => {
    const fetchMock = stubSession(() =>
      toolResponse({ id: "page_123_post_12" }),
    );

    await publishFacebookPost({ ...context, media: [VIDEO_REF] });

    expect(executeCalls(fetchMock)).toEqual([
      {
        tool_slug: "FACEBOOK_CREATE_VIDEO_POST",
        arguments: {
          page_id: "page_123",
          file_url: VIDEO_REF.fileUrl,
          description: "Hello Facebook",
          published: true,
        },
      },
    ]);
  });

  it("raises a tool error when the Page refuses the post", async () => {
    stubSession(() =>
      Response.json({
        data: null,
        error: { message: "pages_manage_posts missing", status: 403 },
        successful: false,
      }),
    );

    await expect(publishFacebookPost(context)).rejects.toMatchObject({
      constructor: ComposioToolError,
      message: "Facebook refused the post",
      providerMessage: "pages_manage_posts missing",
      providerStatus: 403,
    });
  });
});
