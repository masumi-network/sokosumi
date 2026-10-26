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
vi.mock("@sokosumi/net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/net")>()),
  ssrfSafeFetch: ssrfSafeFetchMock,
}));
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

  it("normalises a stored full person URN to a single prefix", async () => {
    const fetchMock = stubSession(() =>
      toolResponse({ id: "urn:li:share:74" }),
    );

    await publishLinkedInPost({
      ...context,
      externalAccountId: "urn:li:person:urn:li:person:person_42",
    });

    expect(executeCalls(fetchMock)[0].arguments.author).toBe(
      "urn:li:person:person_42",
    );
  });

  describe("as a company page", () => {
    const pageContext = {
      ...context,
      externalAccountId: "urn:li:organization:777",
      externalHandle: "example-company",
    };
    const VIDEO_REF = {
      pathname: "drive/users/user_1/clip.mp4",
      fileUrl:
        "https://store.public.blob.vercel-storage.com/drive/users/user_1/clip.mp4",
      name: "clip.mp4",
      size: 6,
      mimeType: "video/mp4",
      kind: "video" as const,
    };

    interface ProxyCall {
      endpoint: string;
      method: string;
      parameters: { name: string; value: string; type: string }[];
      body?: Record<string, unknown>;
      connected_account_id: string;
    }

    function stubPageVideo(
      respond: (call: ProxyCall) => {
        status: number;
        data?: unknown;
        headers?: Record<string, string>;
      },
    ) {
      const fetchMock = vi.fn(
        async (url: URL, init?: RequestInit): Promise<Response> => {
          if (url.pathname === "/api/v3.1/tools/execute/proxy") {
            return Response.json(respond(JSON.parse(String(init?.body))));
          }
          if (url.pathname === "/api/v3.1/tool_router/session") {
            return Response.json({ session_id: "sess_li" });
          }
          if (init?.method === "DELETE") return Response.json({});
          throw new Error(`Unexpected path ${url.pathname}`);
        },
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    function proxyCalls(fetchMock: ReturnType<typeof stubPageVideo>) {
      return fetchMock.mock.calls
        .filter(([url]) => url.pathname.endsWith("/proxy"))
        .map(([, init]) => JSON.parse(String(init?.body)) as ProxyCall);
    }

    function videoResponder(call: ProxyCall) {
      const action = call.parameters.find((p) => p.name === "action")?.value;
      if (action === "initializeUpload") {
        return {
          status: 200,
          data: {
            value: {
              video: "urn:li:video:C5",
              uploadToken: "",
              uploadInstructions: [
                {
                  uploadUrl: "https://www.linkedin.com/dms-uploads/part-1",
                  firstByte: 0,
                  lastByte: 3,
                },
                {
                  uploadUrl: "https://www.linkedin.com/dms-uploads/part-2",
                  firstByte: 4,
                  lastByte: 5,
                },
              ],
            },
          },
        };
      }
      if (action === "finalizeUpload") return { status: 200, data: {} };
      if (call.method === "GET") {
        return { status: 200, data: { status: "AVAILABLE" } };
      }
      return {
        status: 201,
        data: {},
        headers: { "X-RestLi-Id": "urn:li:share:900" },
      };
    }

    it("publishes text with the organization as author", async () => {
      const fetchMock = stubSession(() =>
        toolResponse({ id: "urn:li:share:81" }),
      );

      await expect(publishLinkedInPost(pageContext)).resolves.toMatchObject({
        externalId: "urn:li:share:81",
        toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
      });
      expect(executeCalls(fetchMock)).toEqual([
        {
          tool_slug: "LINKEDIN_CREATE_LINKED_IN_POST",
          arguments: {
            author: "urn:li:organization:777",
            commentary: "Hello LinkedIn",
            visibility: "PUBLIC",
            lifecycleState: "PUBLISHED",
          },
        },
      ]);
    });

    it("registers images owned by the organization", async () => {
      const fetchMock = stubSession((call) =>
        call.tool_slug === "LINKEDIN_REGISTER_IMAGE_UPLOAD"
          ? toolResponse({
              upload_url: "https://www.linkedin.com/upload/1",
              asset_urn: "urn:li:image:asset_1",
            })
          : toolResponse({ id: "urn:li:share:82" }),
      );
      downloadSocialPostMediaMock.mockResolvedValue([
        {
          bytes: new Uint8Array([1, 2, 3]),
          name: "photo.jpg",
          mimeType: "image/jpeg",
          kind: "image",
        },
      ]);

      await publishLinkedInPost({
        ...pageContext,
        media: [LINKEDIN_IMAGE_REF],
      });

      expect(executeCalls(fetchMock)).toEqual([
        {
          tool_slug: "LINKEDIN_REGISTER_IMAGE_UPLOAD",
          arguments: { owner_urn: "urn:li:organization:777" },
        },
        {
          tool_slug: "LINKEDIN_CREATE_LINKED_IN_POST",
          arguments: {
            author: "urn:li:organization:777",
            commentary: "Hello LinkedIn",
            visibility: "PUBLIC",
            lifecycleState: "PUBLISHED",
            images: ["urn:li:image:asset_1"],
          },
        },
      ]);
    });

    it("uploads a video through the Videos API and posts it as the organization", async () => {
      const fetchMock = stubPageVideo(videoResponder);
      downloadSocialPostMediaMock.mockResolvedValue([
        {
          bytes: new Uint8Array([1, 2, 3, 4, 5, 6]),
          name: "clip.mp4",
          mimeType: "video/mp4",
          kind: "video",
        },
      ]);
      ssrfSafeFetchMock
        .mockResolvedValueOnce(
          new Response("", { headers: { etag: "etag-1" } }),
        )
        .mockResolvedValueOnce(
          new Response("", { headers: { etag: "etag-2" } }),
        );

      await expect(
        publishLinkedInPost({ ...pageContext, media: [VIDEO_REF] }),
      ).resolves.toEqual({
        externalId: "urn:li:share:900",
        publishedUrl: "https://www.linkedin.com/feed/update/urn:li:share:900",
        toolSlug: "LINKEDIN_PROXY_ORGANIZATION_VIDEO_POST",
      });

      const calls = proxyCalls(fetchMock);
      expect(calls.every((call) => call.connected_account_id === "ca_li")).toBe(
        true,
      );
      expect(calls[0]).toMatchObject({
        endpoint: "https://api.linkedin.com/rest/videos",
        method: "POST",
        body: {
          initializeUploadRequest: {
            owner: "urn:li:organization:777",
            fileSizeBytes: 6,
          },
        },
      });
      expect(
        ssrfSafeFetchMock.mock.calls.map(([url, init]) => [
          url,
          Array.from(init.body as Uint8Array),
        ]),
      ).toEqual([
        ["https://www.linkedin.com/dms-uploads/part-1", [1, 2, 3, 4]],
        ["https://www.linkedin.com/dms-uploads/part-2", [5, 6]],
      ]);
      expect(calls[1].body).toEqual({
        finalizeUploadRequest: {
          video: "urn:li:video:C5",
          uploadToken: "",
          uploadedPartIds: ["etag-1", "etag-2"],
        },
      });
      expect(calls[2]).toMatchObject({
        endpoint: "https://api.linkedin.com/rest/videos/urn%3Ali%3Avideo%3AC5",
        method: "GET",
      });
      expect(calls[3]).toMatchObject({
        endpoint: "https://api.linkedin.com/rest/posts",
        method: "POST",
        body: {
          author: "urn:li:organization:777",
          commentary: "Hello LinkedIn",
          content: { media: { id: "urn:li:video:C5" } },
          lifecycleState: "PUBLISHED",
        },
      });
      expect(
        calls[3].parameters.find((p) => p.name === "LinkedIn-Version"),
      ).toBeDefined();
      // Composio's member-only video tools are never used for a page.
      expect(
        fetchMock.mock.calls.some(([url]) => url.pathname.endsWith("/execute")),
      ).toBe(false);
    });

    it("fails without posting when LinkedIn cannot process the video", async () => {
      const fetchMock = stubPageVideo((call) =>
        call.method === "GET"
          ? { status: 200, data: { status: "PROCESSING_FAILED" } }
          : videoResponder(call),
      );
      downloadSocialPostMediaMock.mockResolvedValue([
        {
          bytes: new Uint8Array([1, 2, 3, 4, 5, 6]),
          name: "clip.mp4",
          mimeType: "video/mp4",
          kind: "video",
        },
      ]);
      ssrfSafeFetchMock.mockResolvedValue(
        new Response("", { headers: { etag: "etag" } }),
      );

      await expect(
        publishLinkedInPost({ ...pageContext, media: [VIDEO_REF] }),
      ).rejects.toMatchObject({
        constructor: ComposioToolError,
        message: "LinkedIn could not process the video",
      });
      expect(
        proxyCalls(fetchMock).some((call) => call.endpoint.endsWith("/posts")),
      ).toBe(false);
    });

    it("marks the outcome unknown when creating the video post fails upstream", async () => {
      stubPageVideo((call) =>
        call.endpoint.endsWith("/posts")
          ? { status: 504, data: { message: "Gateway timeout" } }
          : videoResponder(call),
      );
      downloadSocialPostMediaMock.mockResolvedValue([
        {
          bytes: new Uint8Array([1, 2, 3, 4, 5, 6]),
          name: "clip.mp4",
          mimeType: "video/mp4",
          kind: "video",
        },
      ]);
      ssrfSafeFetchMock.mockResolvedValue(
        new Response("", { headers: { etag: "etag" } }),
      );

      const { ComposioPublishOutcomeUnknownError } = await import(
        "@/clients/social-post-providers/tools"
      );
      await expect(
        publishLinkedInPost({ ...pageContext, media: [VIDEO_REF] }),
      ).rejects.toBeInstanceOf(ComposioPublishOutcomeUnknownError);
    });
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
