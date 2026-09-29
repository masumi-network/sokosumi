import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishLinkedInPost } from "@/clients/social-post-providers/linkedin";
import { ComposioToolError } from "@/clients/social-post-providers/tools";

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
  provider: "linkedin" as const,
  connectedAccountId: "ca_li",
  executorUserId: "sokosumi:project-executor:project_123",
  externalAccountId: "person_42",
  externalHandle: "ada",
  text: "Hello LinkedIn",
  media: [],
};

const LINKEDIN_IMAGE_REF = {
  pathname: "drive/users/user_1/photo.jpg",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/photo.jpg",
  name: "photo.jpg",
  size: 3,
  mimeType: "image/jpeg",
  kind: "image" as const,
};

interface ExecuteCall {
  tool_slug: string;
  arguments: Record<string, unknown>;
}

function stubSession(execute: (call: ExecuteCall) => Response) {
  const fetchMock = vi.fn(
    async (url: URL, init?: RequestInit): Promise<Response> => {
      if (url.pathname === "/api/v3.1/tool_router/session") {
        return Response.json({ session_id: "sess_li" });
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

describe("publishLinkedInPost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
    ssrfSafeFetchMock.mockResolvedValue(new Response(""));
  });

  it("publishes a text-only post as the connected person", async () => {
    const fetchMock = stubSession(() =>
      toolResponse({ id: "urn:li:share:71" }),
    );

    await expect(publishLinkedInPost(context)).resolves.toEqual({
      externalId: "urn:li:share:71",
      publishedUrl: "https://www.linkedin.com/feed/update/urn:li:share:71",
      toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
    });

    const sessionBody = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body),
    ) as { toolkits: { enable: string[] } };
    expect(sessionBody.toolkits.enable).toEqual(["linkedin"]);
    expect(executeCalls(fetchMock)).toEqual([
      {
        tool_slug: "LINKEDIN_CREATE_LINKED_IN_POST",
        arguments: {
          author: "urn:li:person:person_42",
          commentary: "Hello LinkedIn",
          visibility: "PUBLIC",
          lifecycleState: "PUBLISHED",
        },
      },
    ]);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("registers each image and attaches the asset URNs", async () => {
    const fetchMock = stubSession((call) => {
      if (call.tool_slug === "LINKEDIN_REGISTER_IMAGE_UPLOAD") {
        const nth = executeCalls(fetchMock).length;
        return toolResponse({
          upload_url: `https://www.linkedin.com/upload/${nth}`,
          asset_urn: `urn:li:image:asset_${nth}`,
        });
      }
      return toolResponse({ id: "urn:li:share:72" });
    });
    downloadSocialPostMediaMock.mockResolvedValue([
      {
        bytes: new Uint8Array([1, 2, 3]),
        name: "photo.jpg",
        mimeType: "image/jpeg",
        kind: "image",
      },
      {
        bytes: new Uint8Array([4, 5, 6]),
        name: "second.jpg",
        mimeType: "image/jpeg",
        kind: "image",
      },
    ]);

    await publishLinkedInPost({
      ...context,
      media: [
        LINKEDIN_IMAGE_REF,
        { ...LINKEDIN_IMAGE_REF, name: "second.jpg" },
      ],
    });

    expect(downloadSocialPostMediaMock).toHaveBeenCalledWith(
      "linkedin",
      expect.any(Array),
      undefined,
    );
    expect(
      executeCalls(fetchMock)
        .filter((call) => call.tool_slug === "LINKEDIN_REGISTER_IMAGE_UPLOAD")
        .map((call) => call.arguments),
    ).toEqual([
      { owner_urn: "urn:li:person:person_42" },
      { owner_urn: "urn:li:person:person_42" },
    ]);
    expect(ssrfSafeFetchMock).toHaveBeenCalledTimes(2);
    expect(executeCalls(fetchMock).at(-1)).toEqual({
      tool_slug: "LINKEDIN_CREATE_LINKED_IN_POST",
      arguments: {
        author: "urn:li:person:person_42",
        commentary: "Hello LinkedIn",
        visibility: "PUBLIC",
        lifecycleState: "PUBLISHED",
        images: ["urn:li:image:asset_1", "urn:li:image:asset_2"],
      },
    });
  });

  it("uploads a video by URL and publishes the video post", async () => {
    const fetchMock = stubSession((call) => {
      if (call.tool_slug === "LINKEDIN_UPLOAD_VIDEO") {
        return toolResponse({ video_urn: "urn:li:video:99" });
      }
      return toolResponse({ id: "urn:li:share:73" });
    });

    const result = await publishLinkedInPost({
      ...context,
      media: [
        {
          pathname: "drive/users/user_1/clip.mp4",
          fileUrl:
            "https://store.public.blob.vercel-storage.com/drive/users/user_1/clip.mp4",
          name: "clip.mp4",
          size: 3,
          mimeType: "video/mp4",
          kind: "video",
        },
      ],
    });

    expect(result).toMatchObject({
      externalId: "urn:li:share:73",
      toolSlug: "LINKEDIN_CREATE_VIDEO_POST",
    });
    expect(downloadSocialPostMediaMock).not.toHaveBeenCalled();
    expect(executeCalls(fetchMock)).toEqual([
      {
        tool_slug: "LINKEDIN_UPLOAD_VIDEO",
        arguments: {
          video_url:
            "https://store.public.blob.vercel-storage.com/drive/users/user_1/clip.mp4",
        },
      },
      {
        tool_slug: "LINKEDIN_CREATE_VIDEO_POST",
        arguments: {
          video_urn: "urn:li:video:99",
          commentary: "Hello LinkedIn",
          visibility: "PUBLIC",
        },
      },
    ]);
  });

  it("raises a tool error when the image registration is refused", async () => {
    stubSession(() =>
      Response.json({
        data: null,
        error: { message: "Missing scope w_member_social", status: 403 },
        successful: false,
      }),
    );
    downloadSocialPostMediaMock.mockResolvedValue([
      {
        bytes: new Uint8Array([1]),
        name: "photo.jpg",
        mimeType: "image/jpeg",
        kind: "image",
      },
    ]);

    await expect(
      publishLinkedInPost({ ...context, media: [LINKEDIN_IMAGE_REF] }),
    ).rejects.toMatchObject({
      constructor: ComposioToolError,
      message: "LinkedIn refused the image upload",
      providerMessage: "Missing scope w_member_social",
      providerStatus: 403,
    });
  });

  it("marks the outcome unknown when the create call times out upstream", async () => {
    stubSession(() => new Response("unavailable", { status: 503 }));

    const { ComposioPublishOutcomeUnknownError } = await import(
      "@/clients/social-post-providers/tools"
    );
    await expect(publishLinkedInPost(context)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
  });
});
