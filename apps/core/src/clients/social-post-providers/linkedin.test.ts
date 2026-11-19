import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConnectedSocialIdentity } from "@/clients/composio.client";
import {
  escapeLinkedInCommentary,
  linkedInPostIdOf,
  publishLinkedInPost,
} from "@/clients/social-post-providers/linkedin";
import { ComposioToolError } from "@/clients/social-post-providers/tools";
import { coreLogEvents, expectCoreLogWhys } from "@/test/core-log";

const zernioRequestMock = vi.hoisted(() => vi.fn());
vi.mock("@/clients/zernio.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/zernio.client")>()),
  zernioRequest: zernioRequestMock,
}));

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

// The real recorders keep their events at the drain seam.
vi.mock("@/lib/evlog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/evlog")>()),
  tryUseLogger: () => ({ set: logSetMock }),
}));
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
  text: "Hello (LinkedIn) #launch",
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
          commentary: "Hello \\(LinkedIn\\) #launch",
          visibility: "PUBLIC",
          lifecycleState: "PUBLISHED",
        },
      },
    ]);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it.each([
    ["a bare stored id", "person_42"],
    ["a legacy full-URN stored id", "urn:li:person:person_42"],
  ])("publishes as the person URN from %s", async (_, externalAccountId) => {
    const fetchMock = stubSession((call) => {
      if (call.tool_slug === "LINKEDIN_REGISTER_IMAGE_UPLOAD") {
        return toolResponse({
          upload_url: "https://www.linkedin.com/upload/1",
          asset_urn: "urn:li:image:asset_1",
        });
      }
      return toolResponse({ id: "urn:li:share:74" });
    });
    downloadSocialPostMediaMock.mockResolvedValue([
      {
        bytes: new Uint8Array([1]),
        name: "photo.jpg",
        mimeType: "image/jpeg",
        kind: "image",
      },
    ]);

    await publishLinkedInPost({
      ...context,
      externalAccountId,
      media: [LINKEDIN_IMAGE_REF],
    });

    const [register, create] = executeCalls(fetchMock);
    expect(register?.arguments.owner_urn).toBe("urn:li:person:person_42");
    expect(create?.arguments.author).toBe("urn:li:person:person_42");
  });

  it("publishes as the person returned by the LinkedIn connect lookup", async () => {
    const fetchMock = stubSession((call) =>
      call.tool_slug === "LINKEDIN_GET_MY_INFO"
        ? toolResponse({
            response_dict: {
              author_id: "urn:li:person:alice",
              given_name: "Alice",
              family_name: "Doe",
            },
          })
        : toolResponse({ id: "urn:li:share:75" }),
    );

    const identity = await getConnectedSocialIdentity({
      provider: "linkedin",
      connectedAccountId: context.connectedAccountId,
      executorUserId: context.executorUserId,
    });
    await publishLinkedInPost({ ...context, externalAccountId: identity.id });

    expect(executeCalls(fetchMock).at(-1)).toMatchObject({
      tool_slug: "LINKEDIN_CREATE_LINKED_IN_POST",
      arguments: { author: "urn:li:person:alice" },
    });
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
        commentary: "Hello \\(LinkedIn\\) #launch",
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
          commentary: "Hello \\(LinkedIn\\) #launch",
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

  it.each([
    ["share_id", { data: { share_id: "urn:li:share:81", status_code: 201 } }],
    [
      "x-restli-id header",
      {
        data: {
          data: {
            response_data: {},
            headers: { "x-restli-id": "urn:li:share:82" },
          },
        },
      },
    ],
    [
      "JSON string payload",
      {
        data: {
          data: JSON.stringify({
            response_dict: { "X-RestLi-Id": "urn:li:ugcPost:83" },
          }),
        },
      },
    ],
    ["numeric share id", { data: { data: { share_id: 84 } } }],
    [
      "URN under an unknown key",
      { data: { data: { result: { created: "urn:li:share:85" } } } },
    ],
  ])("records the post URN from a %s response", async (_shape, body) => {
    stubSession(() =>
      Response.json({ ...body, error: null, successful: true }),
    );

    const result = await publishLinkedInPost(context);

    expect(result.externalId).toMatch(/^urn:li:(share|ugcPost):8[1-5]$/);
    expect(result.publishedUrl).toBe(
      `https://www.linkedin.com/feed/update/${result.externalId}`,
    );
  });

  it("treats a confirmed post without an id as published without a link", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "LinkedIn published a post but returned no post id",
      ["The LinkedIn create post response held no post URN Core recognizes"],
    );
    stubSession(() =>
      toolResponse({
        status_code: 201,
        id: "log_123",
        response_data: { message: "Created", secret: "tok_should_not_log" },
      }),
    );

    await expect(publishLinkedInPost(context)).resolves.toEqual({
      externalId: null,
      publishedUrl: null,
      toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
    });
    expect(warnings[0]?.event).toMatchObject({
      provider: "linkedin",
      toolSlug: "LINKEDIN_CREATE_LINKED_IN_POST",
      keyPaths: ["status_code", "id", "response_data", "response_data.message"],
      otherKeys: 1,
    });
    expect(JSON.stringify(coreLogEvents())).not.toContain("tok_should_not_log");
  });

  it("counts a response key it does not know instead of naming it", async () => {
    expectCoreLogWhys(
      "warn",
      "LinkedIn published a post but returned no post id",
      ["The LinkedIn create post response held no post URN Core recognizes"],
    );
    stubSession(() =>
      toolResponse({
        status_code: 201,
        response_data: { "Ada private launch plan": true },
      }),
    );

    await publishLinkedInPost(context);

    expect(JSON.stringify(coreLogEvents())).not.toContain("Ada private");
  });

  it("only accepts LinkedIn post URNs as the post id", () => {
    expect(linkedInPostIdOf({ id: "log_123" })).toBeNull();
    expect(linkedInPostIdOf({ id: "urn:li:person:abc" })).toBeNull();
    expect(linkedInPostIdOf({ "x-restli-id": ["urn:li:share:9"] })).toBe(
      "urn:li:share:9",
    );
    expect(linkedInPostIdOf({ share_id: "91" })).toBe("urn:li:share:91");
    expect(linkedInPostIdOf({ activity: "urn:li:activity:92" })).toBe(
      "urn:li:activity:92",
    );
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

describe("escapeLinkedInCommentary", () => {
  it("escapes reserved characters and keeps hashtags", () => {
    expect(
      escapeLinkedInCommentary(
        "Test (one) [two] snake_case *star* #hashtag @someone ~ end",
      ),
    ).toBe(
      "Test \\(one\\) \\[two\\] snake\\_case \\*star\\* #hashtag \\@someone \\~ end",
    );
  });

  it.each([
    ["a\\b", "a\\\\b"],
    ["a|b", "a\\|b"],
    ["{a}", "\\{a\\}"],
    ["<a>", "\\<a\\>"],
    ["#", "\\#"],
    ["# ", "\\# "],
    ["C#", "C\\#"],
    ["#snake_case", "#snake_case"],
    ["#café2026 ok", "#café2026 ok"],
    ["line one\nline two 🚀", "line one\nline two 🚀"],
    ["", ""],
  ])("escapes %j", (text, expected) => {
    expect(escapeLinkedInCommentary(text)).toBe(expected);
  });
});

describe("LinkedIn through Zernio", () => {
  const input = {
    ...context,
    postId: "post-123",
    connectedAccountId: "zernio:page-account",
    externalAccountId: "urn:li:organization:42",
    firstComment: " https://acme.example/launch ",
  };
  const published = {
    post: {
      _id: "zpost",
      platforms: [
        {
          platform: "linkedin",
          accountId: "page-account",
          status: "published",
          platformPostUrl:
            "https://www.linkedin.com/feed/update/urn:li:share:7",
        },
      ],
    },
  };

  beforeEach(() => zernioRequestMock.mockReset());

  it("posts as the picked account, with the first comment in the same call", async () => {
    zernioRequestMock.mockResolvedValueOnce(published);
    await expect(publishLinkedInPost(input)).resolves.toEqual({
      externalId: "zpost",
      publishedUrl: "https://www.linkedin.com/feed/update/urn:li:share:7",
      toolSlug: "ZERNIO_LINKEDIN_CREATE_POST",
      firstCommentIncluded: true,
    });
    expect(zernioRequestMock).toHaveBeenCalledWith("/posts", {
      method: "POST",
      idempotencyKey: "post-123",
      signal: undefined,
      body: {
        publishNow: true,
        content: input.text,
        platforms: [
          {
            platform: "linkedin",
            accountId: "page-account",
            platformSpecificData: {
              firstComment: "https://acme.example/launch",
            },
          },
        ],
      },
    });
    // No Composio session: the Zernio account is the Page.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends one video alone, or every image", async () => {
    const image = {
      pathname: "drive/a.jpg",
      fileUrl: "https://store.public.blob.vercel-storage.com/a.jpg",
      name: "a.jpg",
      size: 1,
      mimeType: "image/jpeg",
      kind: "image" as const,
    };
    const video = {
      ...image,
      fileUrl: "https://store.public.blob.vercel-storage.com/a.mp4",
      mimeType: "video/mp4",
      kind: "video" as const,
    };
    zernioRequestMock.mockResolvedValue(published);
    await publishLinkedInPost({ ...input, media: [image, image] });
    expect(zernioRequestMock.mock.calls[0][1].body.mediaItems).toEqual([
      { type: "image", url: image.fileUrl },
      { type: "image", url: image.fileUrl },
    ]);
    await publishLinkedInPost({ ...input, media: [image, video] });
    expect(zernioRequestMock.mock.calls[1][1].body.mediaItems).toEqual([
      { type: "video", url: video.fileUrl },
    ]);
  });

  it("reports a refusal, and an unknown outcome when Zernio does not answer", async () => {
    const { ZernioApiError } = await import("@/clients/zernio.client");
    zernioRequestMock.mockRejectedValueOnce(new ZernioApiError(422));
    await expect(publishLinkedInPost(input)).rejects.toMatchObject({
      name: "ComposioToolError",
      message: "LinkedIn refused the post (HTTP 422)",
    });
    zernioRequestMock.mockRejectedValueOnce(new ZernioApiError(502));
    await expect(publishLinkedInPost(input)).rejects.toMatchObject({
      name: "ComposioPublishOutcomeUnknownError",
    });
  });
});
