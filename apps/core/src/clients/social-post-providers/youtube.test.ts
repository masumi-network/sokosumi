import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import {
  deriveYouTubeTitle,
  publishYouTubeVideo,
} from "@/clients/social-post-providers/youtube";

const {
  getEnvMock,
  logSetMock,
  ssrfSafeFetchMock,
  downloadSocialPostMediaMock,
} = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  logSetMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
  downloadSocialPostMediaMock: vi.fn(),
}));

vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => ({ set: logSetMock }) }));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: ssrfSafeFetchMock }));
vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/helpers/social-post-media", () => ({
  downloadSocialPostMedia: downloadSocialPostMediaMock,
}));

const context = {
  provider: "youtube" as const,
  connectedAccountId: "ca_yt",
  executorUserId: "sokosumi:project-executor:project_123",
  externalAccountId: "UC_123",
  externalHandle: "@alice",
  text: "Launching today\nSecond line",
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
        return Response.json({ session_id: "sess_yt" });
      }
      if (url.pathname === "/api/v3.1/files/upload/request") {
        return Response.json({
          key: "staged-video",
          new_presigned_url: "https://uploads.example.com/video?signed=token",
        });
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

describe("deriveYouTubeTitle", () => {
  it("uses the first non-empty line, trimmed", () => {
    expect(deriveYouTubeTitle("\n  Launch today  \nmore text")).toBe(
      "Launch today",
    );
  });

  it("caps the title at 100 characters", () => {
    expect(deriveYouTubeTitle("x".repeat(140))).toHaveLength(100);
  });

  it("falls back to a placeholder for empty text", () => {
    expect(deriveYouTubeTitle("   \n  ")).toBe("Untitled");
  });
});

describe("publishYouTubeVideo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
    ssrfSafeFetchMock.mockResolvedValue(new Response(""));
    downloadSocialPostMediaMock.mockResolvedValue([
      {
        bytes: new Uint8Array([1, 2, 3]),
        name: "clip.mp4",
        mimeType: "video/mp4",
        kind: "video",
      },
    ]);
  });

  it("stages the video and uploads it with derived metadata", async () => {
    const fetchMock = stubSession(() => toolResponse({ id: "video_123" }));

    await expect(publishYouTubeVideo(context)).resolves.toEqual({
      externalId: "video_123",
      publishedUrl: "https://www.youtube.com/watch?v=video_123",
      providerOutcome: "public",
      toolSlug: "YOUTUBE_UPLOAD_VIDEO",
    });

    const staging = fetchMock.mock.calls.find(([url]) =>
      url.pathname.endsWith("/files/upload/request"),
    );
    expect(JSON.parse(String(staging?.[1]?.body))).toMatchObject({
      toolkit_slug: "youtube",
      tool_slug: "YOUTUBE_UPLOAD_VIDEO",
      filename: "clip.mp4",
      mimetype: "video/mp4",
    });
    expect(executeCalls(fetchMock)).toEqual([
      {
        tool_slug: "YOUTUBE_UPLOAD_VIDEO",
        arguments: {
          title: "Launching today",
          description: "Launching today\nSecond line",
          tags: [],
          categoryId: "22",
          privacyStatus: "public",
          videoFilePath: {
            name: "clip.mp4",
            mimetype: "video/mp4",
            s3key: "staged-video",
          },
        },
      },
    ]);
  });

  it("raises a tool error when YouTube refuses the upload", async () => {
    stubSession(() =>
      Response.json({
        data: null,
        error: { message: "quotaExceeded", status: 403 },
        successful: false,
      }),
    );

    await expect(publishYouTubeVideo(context)).rejects.toMatchObject({
      constructor: ComposioToolError,
      message: "YouTube refused the upload",
      providerMessage: "quotaExceeded",
      providerStatus: 403,
    });
  });
});
