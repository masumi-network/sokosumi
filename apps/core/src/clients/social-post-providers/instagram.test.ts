import { beforeEach, describe, expect, it, vi } from "vitest";

import { ComposioApiError } from "@/clients/composio.client";
import { publishInstagramPost } from "@/clients/social-post-providers/instagram";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/social-post-providers/tools";

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

  it.each([2, 10])(
    "publishes a carousel of %i images in order",
    async (count) => {
      const media = Array.from({ length: count }, (_, index) => ({
        ...IMAGE_REF,
        pathname: `drive/users/user_1/photo-${index}.jpg`,
        fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/user_1/photo-${index}.jpg`,
        name: `photo-${index}.jpg`,
      }));
      const fetchMock = stubSession((call) =>
        call.tool_slug === "INSTAGRAM_CREATE_CAROUSEL_CONTAINER"
          ? toolResponse({ id: "carousel_1" })
          : toolResponse({ id: "media_80" }),
      );

      await expect(
        publishInstagramPost({ ...context, media }),
      ).resolves.toEqual({
        externalId: "media_80",
        publishedUrl: null,
        toolSlug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
      });
      expect(executeCalls(fetchMock)).toEqual([
        {
          tool_slug: "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
          arguments: {
            ig_user_id: "17841400000000000",
            caption: "Hello Instagram",
            child_image_urls: media.map((ref) => ref.fileUrl),
          },
        },
        {
          tool_slug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
          arguments: {
            ig_user_id: "17841400000000000",
            creation_id: "carousel_1",
            max_wait_seconds: 180,
          },
        },
      ]);
      expect(
        JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
      ).toMatchObject({
        connected_accounts: { instagram: [context.connectedAccountId] },
        tools: {
          instagram: {
            enable: [
              "INSTAGRAM_POST_IG_USER_MEDIA",
              "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
              "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
            ],
          },
        },
      });
    },
  );

  it.each([2, 10])(
    "publishes a carousel of %i videos in order",
    async (count) => {
      const media = Array.from({ length: count }, (_, index) => ({
        ...VIDEO_REF,
        pathname: `drive/users/user_1/clip-${index}.mp4`,
        fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/user_1/clip-${index}.mp4`,
        name: `clip-${index}.mp4`,
      }));
      const fetchMock = stubSession((call) =>
        call.tool_slug === "INSTAGRAM_CREATE_CAROUSEL_CONTAINER"
          ? toolResponse({ creation_id: "carousel_2" })
          : toolResponse({ id: "media_81" }),
      );

      await publishInstagramPost({
        ...context,
        text: "",
        media,
      });

      expect(executeCalls(fetchMock)[0]).toEqual({
        tool_slug: "INSTAGRAM_CREATE_CAROUSEL_CONTAINER",
        arguments: {
          ig_user_id: "17841400000000000",
          child_video_urls: media.map((ref) => ref.fileUrl),
        },
      });
      expect(executeCalls(fetchMock)[1]).toMatchObject({
        tool_slug: "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH",
        arguments: { creation_id: "carousel_2" },
      });
    },
  );

  it.each([1, 2])(
    "raises a tool error when a %i-item container is refused",
    async (count) => {
      const fetchMock = stubSession(() =>
        Response.json({
          data: null,
          error: { message: "Invalid image aspect ratio", status: 400 },
          successful: false,
        }),
      );

      await expect(
        publishInstagramPost({
          ...context,
          media: Array(count).fill(IMAGE_REF),
        }),
      ).rejects.toMatchObject({
        constructor: ComposioToolError,
        message: "Instagram refused the media",
        providerMessage: "Invalid image aspect ratio",
        providerStatus: 400,
      });
      expect(executeCalls(fetchMock)).toHaveLength(1);
      expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    },
  );

  it.each([1, 2])(
    "never publishes a %i-item container without an id",
    async (count) => {
      const fetchMock = stubSession(() => toolResponse({}));

      await expect(
        publishInstagramPost({
          ...context,
          media: Array(count).fill(IMAGE_REF),
        }),
      ).rejects.toMatchObject({
        message: "Instagram container creation returned no id",
      });
      expect(executeCalls(fetchMock)).toHaveLength(1);
      expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    },
  );

  it.each([1, 2])(
    "keeps a %i-item container transport failure safe to retry",
    async (count) => {
      const fetchMock = stubSession(() => Response.json({}, { status: 503 }));

      await expect(
        publishInstagramPost({
          ...context,
          media: Array(count).fill(IMAGE_REF),
        }),
      ).rejects.toBeInstanceOf(ComposioApiError);
      expect(executeCalls(fetchMock)).toHaveLength(1);
      expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    },
  );

  it.each([1, 2])(
    "guards an unknown publish outcome for %i items against retries",
    async (count) => {
      const fetchMock = stubSession((call) =>
        call.tool_slug === "INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH"
          ? Response.json({
              data: null,
              error: { message: "Processing timed out", status: 504 },
              successful: false,
            })
          : toolResponse({ id: "container_1" }),
      );

      await expect(
        publishInstagramPost({
          ...context,
          media: Array(count).fill(IMAGE_REF),
        }),
      ).rejects.toBeInstanceOf(ComposioPublishOutcomeUnknownError);
      expect(executeCalls(fetchMock)).toHaveLength(2);
      expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    },
  );
});
