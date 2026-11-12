import {
  type SocialPostMediaKind,
  socialPostMaxBytesForKind,
} from "@sokosumi/utils";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposioApiError } from "@/clients/composio.client";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/social-post-providers/tools";
import { publishXPost } from "@/clients/social-post-providers/x";

const X_IMAGE_MAX_BYTES = socialPostMaxBytesForKind("x", "image");

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
vi.mock("@/helpers/social-post-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/social-post-media")>()),
  downloadSocialPostMedia: downloadSocialPostMediaMock,
}));

const PNG_BYTES = await sharp({
  create: {
    width: 2,
    height: 2,
    channels: 4,
    background: { r: 100, g: 50, b: 25, alpha: 0.5 },
  },
})
  .png()
  .toBuffer();
const JPEG_BYTES = await sharp(PNG_BYTES).jpeg().toBuffer();
const WEBP_BYTES = await sharp(PNG_BYTES).webp({ lossless: true }).toBuffer();

function xResult(externalId: string) {
  return {
    externalId,
    publishedUrl: `https://x.com/i/web/status/${externalId}`,
    toolSlug: "TWITTER_CREATION_OF_A_POST",
  };
}

function mediaRef(
  mimeType: string,
  kind: SocialPostMediaKind,
  options: { bytes?: Uint8Array<ArrayBuffer>; name?: string } = {},
) {
  const name = options.name ?? "attachment";
  downloadSocialPostMediaMock.mockResolvedValue([
    {
      bytes:
        options.bytes ?? (kind === "image" ? PNG_BYTES : new Uint8Array([1])),
      name,
      mimeType,
      kind,
    },
  ]);
  return {
    pathname: `drive/users/user_1/${name}`,
    fileUrl: `https://store.public.blob.vercel-storage.com/drive/users/user_1/${name}`,
    name,
    size: 1,
    mimeType,
    kind,
  };
}

describe("publishXPost", () => {
  const publishInput = {
    provider: "x" as const,
    connectedAccountId: "ca_123",
    externalAccountId: "x_123",
    externalHandle: null,
    executorUserId: "sokosumi:project-executor:project_123",
    text: "Hello world",
    media: [],
  };

  function stubSession(execute: () => Promise<Response> | Response) {
    const fetchMock = vi.fn(
      async (url: URL, init?: RequestInit): Promise<Response> => {
        const path = url.pathname;
        if (path === "/api/v3.1/tool_router/session") {
          const body = JSON.parse(String(init?.body));
          // REST rejects the SDK's array shorthand before any post is sent.
          if (Array.isArray(body.toolkits)) {
            return Response.json(
              { error: "Invalid toolkits" },
              { status: 400 },
            );
          }
          return new Response(JSON.stringify({ session_id: "sess_1" }));
        }
        if (path.endsWith("/execute")) {
          return execute();
        }
        if (init?.method === "DELETE") {
          return new Response(JSON.stringify({}));
        }
        throw new Error(`unexpected ${path}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function calls(fetchMock: ReturnType<typeof stubSession>) {
    return fetchMock.mock.calls.map(([url, init]) => ({
      path: url.pathname,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    }));
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("passes the preceding thread part id to the Composio reply argument", async () => {
    const fetchMock = stubSession(() =>
      Response.json({
        data: { data: { id: "1908" } },
        successful: true,
        error: null,
      }),
    );
    await publishXPost({ ...publishInput, replyToExternalId: "1907" });
    expect(calls(fetchMock)[1].body.arguments).toMatchObject({
      text: "Hello world",
      reply_in_reply_to_tweet_id: "1907",
    });
  });

  it("passes the quoted post's X id to Composio", async () => {
    const fetchMock = stubSession(() =>
      Response.json({
        data: { data: { id: "1908" } },
        successful: true,
        error: null,
      }),
    );
    await publishXPost({ ...publishInput, quoteExternalId: "1907" });
    expect(calls(fetchMock)[1].body.arguments).toEqual({
      text: "Hello world",
      quote_tweet_id: "1907",
    });
  });

  it("creates a restricted session, executes the create-post tool, and deletes the session", async () => {
    const fetchMock = stubSession(
      () =>
        new Response(
          JSON.stringify({
            data: { data: { data: { id: "1907", text: "Hello world" } } },
            error: null,
            successful: true,
          }),
        ),
    );

    await expect(publishXPost(publishInput)).resolves.toEqual(xResult("1907"));

    const requests = calls(fetchMock);
    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      path: "/api/v3.1/tool_router/session",
      method: "POST",
      body: {
        user_id: publishInput.executorUserId,
        toolkits: { enable: ["twitter"] },
        connected_accounts: { twitter: ["ca_123"] },
        manage_connections: { enable: false, enable_connection_removal: false },
        tools: {
          twitter: {
            enable: ["TWITTER_CREATION_OF_A_POST"],
          },
        },
        workbench: { enable: false, enable_proxy_execution: false },
        search: { enable: false },
      },
    });
    expect(requests[1]).toEqual({
      path: "/api/v3.1/tool_router/session/sess_1/execute",
      method: "POST",
      body: {
        tool_slug: "TWITTER_CREATION_OF_A_POST",
        arguments: { text: "Hello world" },
      },
    });
    expect(requests[2]).toMatchObject({
      path: "/api/v3.1/tool_router/session/sess_1",
      method: "DELETE",
    });
  });

  it("keeps a successful publish when session cleanup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init?: RequestInit): Promise<Response> => {
        const path = url.pathname;
        if (path === "/api/v3.1/tool_router/session") {
          return new Response(JSON.stringify({ session_id: "sess_1" }));
        }
        if (path.endsWith("/execute")) {
          return new Response(
            JSON.stringify({ data: { id: "1907" }, error: null }),
          );
        }
        if (init?.method === "DELETE") {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`unexpected ${path}`);
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(publishXPost(publishInput)).resolves.toEqual(xResult("1907"));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("parses a flat tool result", async () => {
    stubSession(
      () => new Response(JSON.stringify({ data: { id: "42" }, error: null })),
    );

    await expect(publishXPost(publishInput)).resolves.toEqual(xResult("42"));
  });

  it("raises a tool error carrying only the sanitized provider message", async () => {
    const opaqueId = "opaque_1234567890abcdefghijklmnopqrstuvwxyz";
    const fetchMock = stubSession(
      () =>
        new Response(
          JSON.stringify({
            data: null,
            error: {
              message: `Duplicate content.\nsession sess_1 Bearer bearer-secret api_key=api-secret https://internal.example/path ${opaqueId} {"access_token":"short-secret","client_secret":"client-secret","authorization":"Basic dXNlcjpwYXNz","password":"my secret"}`,
              status: 403,
            },
            successful: false,
          }),
        ),
    );

    const error = await publishXPost(publishInput).catch((e) => e);
    expect(error).toBeInstanceOf(ComposioToolError);
    expect(error).toMatchObject({
      providerMessage:
        'Duplicate content. session [redacted] Bearer [redacted] api_key=[redacted] [redacted-url] [redacted-id] {"access_token":"[redacted]","client_secret":"[redacted]","authorization":"[redacted]","password":"[redacted]"}',
      providerStatus: 403,
    });
    expect(error.message).not.toContain("sess_1");
    expect(error.providerMessage).not.toContain("bearer-secret");
    expect(error.providerMessage).not.toContain("api-secret");
    expect(error.providerMessage).not.toContain("internal.example");
    expect(error.providerMessage).not.toContain(opaqueId);
    expect(error.providerMessage).not.toContain("short-secret");
    expect(error.providerMessage).not.toContain("client-secret");
    expect(error.providerMessage).not.toContain("dXNlcjpwYXNz");
    expect(error.providerMessage).not.toContain("my secret");
    expect(calls(fetchMock).at(-1)).toMatchObject({
      path: "/api/v3.1/tool_router/session/sess_1",
      method: "DELETE",
    });
  });

  it("marks the result uncertain when no post id comes back", async () => {
    stubSession(() => new Response(JSON.stringify({ data: { text: "x" } })));

    await expect(publishXPost(publishInput)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
  });

  it("does not allow automatic retries after a create-post transport timeout", async () => {
    stubSession(() => {
      throw new DOMException("Timed out", "TimeoutError");
    });
    await expect(publishXPost(publishInput)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
  });

  it.each([500, 502, 503])(
    "treats create-post HTTP %s as an uncertain external outcome",
    async (status) => {
      stubSession(() => new Response("unavailable", { status }));
      await expect(publishXPost(publishInput)).rejects.toBeInstanceOf(
        ComposioPublishOutcomeUnknownError,
      );
    },
  );

  it("preserves retryable errors before the create-post request starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    await expect(publishXPost(publishInput)).rejects.toMatchObject({
      constructor: ComposioApiError,
      httpStatus: 503,
    });
  });

  it("deletes the session when the execute call fails upstream", async () => {
    const fetchMock = stubSession(
      () => new Response("rate limited", { status: 429 }),
    );

    await expect(publishXPost(publishInput)).rejects.toMatchObject({
      constructor: ComposioApiError,
      httpStatus: 429,
    });
    expect(calls(fetchMock).at(-1)).toMatchObject({
      path: "/api/v3.1/tool_router/session/sess_1",
      method: "DELETE",
    });
  });
});

describe("publishXPost with media", () => {
  const imageInput = {
    provider: "x" as const,
    connectedAccountId: "ca_123",
    externalAccountId: "x_123",
    externalHandle: null,
    executorUserId: "executor",
    text: "Picture",
  };

  interface ExecuteCall {
    tool_slug: string;
    arguments: Record<string, unknown>;
  }
  function toolResponse(data: unknown) {
    return new Response(
      JSON.stringify({ data: { data }, error: null, successful: true }),
    );
  }
  function stubMediaSession(
    execute: (call: ExecuteCall) => Response = (call) =>
      toolResponse({
        id:
          call.tool_slug === "TWITTER_CREATION_OF_A_POST" ? "1907" : "media_1",
        ...(call.tool_slug === "TWITTER_UPLOAD_LARGE_MEDIA"
          ? { processing_info: { state: "succeeded" } }
          : {}),
      }),
  ) {
    const fetchMock = vi.fn(
      async (url: URL, init?: RequestInit): Promise<Response> => {
        if (url.pathname === "/api/v3.1/tool_router/session")
          return new Response(JSON.stringify({ session_id: "sess_1" }));
        if (url.pathname === "/api/v3.1/files/upload/request")
          return new Response(
            JSON.stringify({
              key: "staged-media",
              new_presigned_url:
                "https://uploads.example.com/media?signed=token",
            }),
          );
        if (url.pathname.endsWith("/execute"))
          return execute(JSON.parse(String(init?.body)));
        if (init?.method === "DELETE") return new Response("{}");
        throw new Error(`Unexpected path ${url.pathname}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  function executeCalls(
    fetchMock: ReturnType<typeof stubMediaSession>,
  ): ExecuteCall[] {
    return fetchMock.mock.calls
      .filter(([url]) => url.pathname.endsWith("/execute"))
      .map(([, init]) => JSON.parse(String(init?.body)));
  }
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    ssrfSafeFetchMock.mockReset().mockResolvedValue(new Response(""));
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("normalizes CMYK progressive JPEG to baseline sRGB before upload", async () => {
    const bytes = await sharp(JPEG_BYTES)
      .toColourspace("cmyk")
      .jpeg({ progressive: true })
      .toBuffer();
    expect(await sharp(bytes).metadata()).toMatchObject({
      space: "cmyk",
      isProgressive: true,
    });
    stubMediaSession();
    await publishXPost({
      ...imageInput,
      media: [mediaRef("image/jpeg", "image", { bytes })],
    });
    expect(
      await sharp(ssrfSafeFetchMock.mock.calls[0][1].body).metadata(),
    ).toMatchObject({
      format: "jpeg",
      space: "srgb",
      depth: "uchar",
      isProgressive: false,
    });
  });

  it.each([
    "16-bit PNG",
    "palette PNG",
    "greyscale-alpha PNG",
    "opaque-alpha PNG",
  ])("normalizes %s using the decoded pixels", async (fixture) => {
    let image = sharp(PNG_BYTES);
    if (fixture === "16-bit PNG") image = image.toColourspace("rgb16");
    if (fixture === "greyscale-alpha PNG") image = image.toColourspace("b-w");
    if (fixture === "opaque-alpha PNG")
      image = image.removeAlpha().ensureAlpha();
    const bytes = await image
      .png({ palette: fixture === "palette PNG" })
      .toBuffer();
    const source = await sharp(bytes).metadata();
    if (fixture === "16-bit PNG") expect(source.depth).toBe("ushort");
    if (fixture === "palette PNG") expect(source.isPalette).toBe(true);
    if (fixture === "greyscale-alpha PNG") expect(source.channels).toBe(2);
    const opaque = fixture === "opaque-alpha PNG";
    const fetchMock = stubMediaSession();
    await publishXPost({
      ...imageInput,
      media: [mediaRef("image/png", "image", { bytes, name: "picture.gif" })],
    });
    const staged = ssrfSafeFetchMock.mock.calls[0][1].body;
    expect(await sharp(staged).metadata()).toMatchObject({
      format: opaque ? "jpeg" : "png",
      space: "srgb",
      depth: "uchar",
      hasAlpha: !opaque,
      isPalette: false,
      width: 2,
      height: 2,
    });
    const media = executeCalls(fetchMock)[0].arguments.media;
    expect(media).toMatchObject({
      name: opaque ? "picture.jpeg" : "picture.png",
      mimetype: opaque ? "image/jpeg" : "image/png",
    });
  });

  it.each(["jpeg", "png", "webp"] as const)(
    "auto-orients %s and strips large EXIF, ICC, and XMP blocks",
    async (format) => {
      const bytes = await sharp({
        create: { width: 3, height: 2, channels: 3, background: "white" },
      })
        .withExif({ IFD0: { ImageDescription: "metadata".repeat(4000) } })
        .withMetadata({ orientation: 6 })
        .withIccProfile("p3")
        .withXmp(
          `<x:xmpmeta xmlns:x="adobe:ns:meta/">${"metadata".repeat(4000)}</x:xmpmeta>`,
        )
        .toFormat(format)
        .toBuffer();
      const source = await sharp(bytes).metadata();
      expect(source.exif).toBeDefined();
      expect(source.icc).toBeDefined();
      expect(source.xmp).toBeDefined();
      stubMediaSession();
      await publishXPost({
        ...imageInput,
        media: [mediaRef(`image/${format}`, "image", { bytes })],
      });
      const staged = await sharp(
        ssrfSafeFetchMock.mock.calls[0][1].body,
      ).metadata();
      expect(staged).toMatchObject({
        format: "jpeg",
        width: 2,
        height: 3,
        space: "srgb",
        depth: "uchar",
      });
      for (const key of [
        "exif",
        "icc",
        "xmp",
        "iptc",
        "orientation",
      ] as const) {
        expect(staged[key]).toBeUndefined();
      }
    },
  );

  it("re-encodes an MPO-style JPEG to one baseline image", async () => {
    // MPF APP2 data and a second sharp-generated picture must not survive upload.
    const mpf = Buffer.from([0xff, 0xe2, 0, 8, 0x4d, 0x50, 0x46, 0, 0, 0]);
    const bytes = Buffer.concat([
      JPEG_BYTES.subarray(0, 2),
      mpf,
      JPEG_BYTES.subarray(2),
      JPEG_BYTES,
    ]);
    expect(await sharp(bytes).metadata()).toMatchObject({
      format: "jpeg",
      width: 2,
      height: 2,
    });
    stubMediaSession();
    await publishXPost({
      ...imageInput,
      media: [mediaRef("image/jpeg", "image", { bytes, name: "photo.mpo" })],
    });
    const staged = Buffer.from(ssrfSafeFetchMock.mock.calls[0][1].body);
    expect(staged.includes(Buffer.from("MPF\0"))).toBe(false);
    expect(staged.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(staged.indexOf(Buffer.from([0xff, 0xd9]))).toBe(staged.length - 2);
    expect(await sharp(staged).metadata()).toMatchObject({
      format: "jpeg",
      isProgressive: false,
    });
  });

  it.each(["", "extensionless", "wrong.webp"])(
    "uses the same normalized name for staging and upload (%s)",
    async (name) => {
      const fetchMock = stubMediaSession();
      await publishXPost({
        ...imageInput,
        media: [mediaRef("image/png", "image", { bytes: JPEG_BYTES, name })],
      });
      const staging = fetchMock.mock.calls.find(([url]) =>
        url.pathname.endsWith("/files/upload/request"),
      );
      const file = JSON.parse(String(staging?.[1]?.body));
      expect(file.filename).toBe(
        `${name ? name.replace(/\.[^/.]+$/, "") : "attachment"}.jpeg`,
      );
      expect(executeCalls(fetchMock)[0].arguments.media).toMatchObject({
        name: file.filename,
        mimetype: "image/jpeg",
      });
    },
  );

  it.each([400, 403, 404, 413, 422])(
    "tries alternate image upload after invalid request HTTP %s before creating one post",
    async (status) => {
      const fetchMock = stubMediaSession((call) =>
        call.tool_slug === "TWITTER_UPLOAD_MEDIA"
          ? new Response(
              JSON.stringify({
                successful: false,
                error: {
                  status,
                  type: "https://api.x.com/2/problems/invalid-request",
                  title: "Invalid Request",
                },
              }),
            )
          : toolResponse({
              id:
                call.tool_slug === "TWITTER_CREATION_OF_A_POST"
                  ? "1907"
                  : "fallback_media",
              processing_info: { state: "succeeded" },
            }),
      );
      await expect(
        publishXPost({
          ...imageInput,
          media: [mediaRef("image/png", "image")],
        }),
      ).resolves.toEqual(xResult("1907"));
      const calls = executeCalls(fetchMock);
      expect(calls.map((call) => call.tool_slug)).toEqual([
        "TWITTER_UPLOAD_MEDIA",
        "TWITTER_UPLOAD_LARGE_MEDIA",
        "TWITTER_CREATION_OF_A_POST",
      ]);
      expect(calls[1].arguments).toMatchObject({
        media_category: "tweet_image",
        media: { mimetype: "image/png", name: "attachment.png" },
      });
      expect(calls[2].arguments).toMatchObject({
        media_media_ids: ["fallback_media"],
      });
      expect(
        fetchMock.mock.calls.filter(
          ([url]) => url.pathname === "/api/v3.1/tool_router/session",
        ),
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          url.pathname.endsWith("/files/upload/request"),
        ),
      ).toHaveLength(2);
      expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    },
  );

  it.each([
    { status: 401, message: "Unauthorized" },
    { status: 403, message: "Missing media.write permission" },
    { status: 429, message: "Too many requests" },
    { status: 408, message: "Timeout" },
    { status: 400, message: "Expired token" },
    { status: 400, message: "Rate limit reached" },
    { status: 400, message: "Upload timed out" },
    { status: 503, message: "Unavailable" },
  ])(
    "does not retry image upload for $status $message",
    async ({ status, message }) => {
      const fetchMock = stubMediaSession(
        () =>
          new Response(
            JSON.stringify({ successful: false, error: { status, message } }),
          ),
      );
      await expect(
        publishXPost({
          ...imageInput,
          media: [mediaRef("image/png", "image")],
        }),
      ).rejects.toBeInstanceOf(ComposioToolError);
      expect(executeCalls(fetchMock).map((call) => call.tool_slug)).toEqual([
        "TWITTER_UPLOAD_MEDIA",
      ]);
    },
  );

  it.each([400, 401, 403, 408, 429, 503])(
    "uses nested provider status %s when Composio responds HTTP 400",
    async (status) => {
      const fetchMock = stubMediaSession((call) =>
        call.tool_slug === "TWITTER_UPLOAD_MEDIA"
          ? new Response(
              JSON.stringify({ error: { status, title: "Invalid Request" } }),
              { status: 400 },
            )
          : toolResponse({
              id:
                call.tool_slug === "TWITTER_CREATION_OF_A_POST"
                  ? "1907"
                  : "media_2",
            }),
      );
      const pending = publishXPost({
        ...imageInput,
        media: [mediaRef("image/png", "image")],
      });
      if (status === 400 || status === 403) {
        await expect(pending).resolves.toEqual(xResult("1907"));
        expect(executeCalls(fetchMock)).toHaveLength(3);
      } else {
        await expect(pending).rejects.toBeInstanceOf(ComposioApiError);
        expect(executeCalls(fetchMock)).toHaveLength(1);
      }
    },
  );

  it.each([401, 408, 429, 503])(
    "never retries transport HTTP %s even if its body claims a 400 parameter error",
    async (status) => {
      const fetchMock = stubMediaSession(
        () =>
          new Response(
            JSON.stringify({
              error: { status: 400, title: "Invalid Request" },
            }),
            { status },
          ),
      );
      await expect(
        publishXPost({
          ...imageInput,
          media: [mediaRef("image/png", "image")],
        }),
      ).rejects.toBeInstanceOf(ComposioApiError);
      expect(executeCalls(fetchMock)).toHaveLength(1);
    },
  );

  it("retries a known damaged-image 403 without requesting a new connection", async () => {
    const fetchMock = stubMediaSession((call) =>
      call.tool_slug === "TWITTER_UPLOAD_MEDIA"
        ? new Response(
            JSON.stringify({
              successful: false,
              error: { status: 403, message: "Invalid image data" },
            }),
          )
        : toolResponse({
            id:
              call.tool_slug === "TWITTER_CREATION_OF_A_POST"
                ? "1907"
                : "media_2",
          }),
    );
    await expect(
      publishXPost({ ...imageInput, media: [mediaRef("image/png", "image")] }),
    ).resolves.toEqual(xResult("1907"));
    expect(executeCalls(fetchMock).map((call) => call.tool_slug)).toEqual([
      "TWITTER_UPLOAD_MEDIA",
      "TWITTER_UPLOAD_LARGE_MEDIA",
      "TWITTER_CREATION_OF_A_POST",
    ]);
  });

  it("never retries create-post failures after a successful image upload", async () => {
    const fetchMock = stubMediaSession((call) =>
      call.tool_slug === "TWITTER_CREATION_OF_A_POST"
        ? new Response(
            JSON.stringify({
              successful: false,
              error: { status: 400, message: "Invalid request" },
            }),
          )
        : toolResponse({ id: "media_1" }),
    );
    await expect(
      publishXPost({ ...imageInput, media: [mediaRef("image/png", "image")] }),
    ).rejects.toBeInstanceOf(ComposioToolError);
    expect(executeCalls(fetchMock).map((call) => call.tool_slug)).toEqual([
      "TWITTER_UPLOAD_MEDIA",
      "TWITTER_CREATION_OF_A_POST",
    ]);
  });

  it("does not retry a transport timeout or create a post", async () => {
    const fetchMock = stubMediaSession(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    await expect(
      publishXPost({ ...imageInput, media: [mediaRef("image/png", "image")] }),
    ).rejects.toMatchObject({ httpStatus: 503 });
    expect(executeCalls(fetchMock)).toHaveLength(1);
  });

  it("stops after one unsuccessful alternate upload without creating a post", async () => {
    const fetchMock = stubMediaSession(
      () =>
        new Response(
          JSON.stringify({
            successful: false,
            error: { status: 400, title: "Invalid Request" },
          }),
        ),
    );
    await expect(
      publishXPost({ ...imageInput, media: [mediaRef("image/png", "image")] }),
    ).rejects.toThrow("invalid parameters");
    expect(executeCalls(fetchMock).map((call) => call.tool_slug)).toEqual([
      "TWITTER_UPLOAD_MEDIA",
      "TWITTER_UPLOAD_LARGE_MEDIA",
    ]);
  });

  it.each([
    {
      kind: "image" as const,
      mimeType: "image/png",
      tool: "TWITTER_UPLOAD_MEDIA",
      category: "tweet_image",
    },
    {
      kind: "gif" as const,
      mimeType: "image/gif",
      tool: "TWITTER_UPLOAD_LARGE_MEDIA",
      category: "tweet_gif",
    },
    {
      kind: "video" as const,
      mimeType: "video/mp4",
      tool: "TWITTER_UPLOAD_LARGE_MEDIA",
      category: "tweet_video",
    },
  ])(
    "stages $kind bytes and uses the published FileUploadable contract",
    async ({ kind, mimeType, tool, category }) => {
      const fetchMock = stubMediaSession();
      const bytes =
        kind === "image" ? PNG_BYTES : new Uint8Array([0, 128, 255]);
      const signal = new AbortController().signal;
      await expect(
        publishXPost({
          provider: "x" as const,
          connectedAccountId: "ca_123",
          externalAccountId: "x_123",
          externalHandle: null,
          executorUserId: "executor",
          text: "",
          media: [mediaRef(mimeType, kind, { bytes, name: "original-file" })],
          signal,
        }),
      ).resolves.toEqual(xResult("1907"));
      const staging = fetchMock.mock.calls.find(([url]) =>
        url.pathname.endsWith("/files/upload/request"),
      );
      expect(JSON.parse(String(staging?.[1]?.body))).toMatchObject({
        toolkit_slug: "twitter",
        tool_slug: tool,
        filename: kind === "image" ? "original-file.png" : "original-file",
        mimetype: mimeType,
        md5: expect.stringMatching(/^[a-f0-9]{32}$/),
      });
      expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
        "https://uploads.example.com/media?signed=token",
        expect.objectContaining({
          method: "PUT",
          body: kind === "image" ? expect.any(Uint8Array) : bytes,
          headers: { "Content-Type": mimeType },
          maxResponseBytes: 65536,
          signal: expect.any(AbortSignal),
        }),
      );
      expect(executeCalls(fetchMock)).toEqual([
        {
          tool_slug: tool,
          arguments: {
            media: {
              name: kind === "image" ? "original-file.png" : "original-file",
              mimetype: mimeType,
              s3key: "staged-media",
            },
            media_category: category,
            ...(kind === "image" ? { media_type: mimeType } : {}),
          },
        },
        {
          tool_slug: "TWITTER_CREATION_OF_A_POST",
          arguments: { media_media_ids: ["media_1"] },
        },
      ]);
    },
  );

  it.each([
    { bytes: JPEG_BYTES, mimeType: "image/jpeg" },
    { bytes: PNG_BYTES, mimeType: "image/png" },
  ])(
    "normalizes ordinary $mimeType image bytes",
    async ({ bytes, mimeType }) => {
      const fetchMock = stubMediaSession();
      await publishXPost({
        ...imageInput,
        media: [mediaRef(mimeType, "image", { bytes })],
      });

      expect(ssrfSafeFetchMock.mock.calls[0][1]).toMatchObject({
        body: expect.any(Uint8Array),
        headers: { "Content-Type": mimeType },
      });
      expect(executeCalls(fetchMock)[0].arguments).toMatchObject({
        media: { mimetype: mimeType },
        media_type: mimeType,
      });
    },
  );

  it("uses the decoded image type when the declared MIME type is wrong", async () => {
    const fetchMock = stubMediaSession();
    await publishXPost({
      ...imageInput,
      media: [
        mediaRef("image/webp", "image", {
          bytes: JPEG_BYTES,
          name: "picture.webp",
        }),
      ],
    });

    const staging = fetchMock.mock.calls.find(([url]) =>
      url.pathname.endsWith("/files/upload/request"),
    );
    expect(JSON.parse(String(staging?.[1]?.body))).toMatchObject({
      filename: "picture.jpeg",
      mimetype: "image/jpeg",
    });
    expect(ssrfSafeFetchMock.mock.calls[0][1]).toMatchObject({
      body: expect.any(Uint8Array),
      headers: { "Content-Type": "image/jpeg" },
    });
    expect(executeCalls(fetchMock)[0].arguments).toMatchObject({
      media: { name: "picture.jpeg", mimetype: "image/jpeg" },
      media_type: "image/jpeg",
    });
  });

  it("converts WebP to PNG before staging without changing dimensions or transparency", async () => {
    const fetchMock = stubMediaSession();
    await publishXPost({
      ...imageInput,
      media: [
        mediaRef("image/webp", "image", {
          bytes: WEBP_BYTES,
          name: "picture.webp",
        }),
      ],
    });

    const staging = fetchMock.mock.calls.find(([url]) =>
      url.pathname.endsWith("/files/upload/request"),
    );
    expect(JSON.parse(String(staging?.[1]?.body))).toMatchObject({
      tool_slug: "TWITTER_UPLOAD_MEDIA",
      filename: "picture.png",
      mimetype: "image/png",
    });
    const stagedBytes = ssrfSafeFetchMock.mock.calls[0][1].body;
    expect(await sharp(stagedBytes).metadata()).toMatchObject({
      format: "png",
      width: 2,
      height: 2,
      hasAlpha: true,
    });
    expect(await sharp(stagedBytes).raw().toBuffer()).toEqual(
      await sharp(WEBP_BYTES).raw().toBuffer(),
    );
    expect(executeCalls(fetchMock)[0]).toMatchObject({
      tool_slug: "TWITTER_UPLOAD_MEDIA",
      arguments: {
        media: { name: "picture.png", mimetype: "image/png" },
        media_category: "tweet_image",
        media_type: "image/png",
      },
    });
  });

  it.each([
    {
      bytes: new Uint8Array(),
      message:
        "The image could not be read. Attach a JPEG, PNG or WebP image and try again.",
    },
    {
      bytes: new Uint8Array([0, 128, 255]),
      message:
        "The image could not be read. Attach a JPEG, PNG or WebP image and try again.",
    },
    {
      bytes: new Uint8Array(X_IMAGE_MAX_BYTES + 1),
      message:
        "The image is larger than X's 5 MB limit. Choose a smaller image and try again.",
    },
  ])(
    "rejects unsuitable image bytes before staging ($message)",
    async ({ bytes, message }) => {
      const fetchMock = stubMediaSession();
      await expect(
        publishXPost({
          ...imageInput,
          media: [mediaRef("image/png", "image", { bytes })],
        }),
      ).rejects.toThrow(message);
      expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
      expect(executeCalls(fetchMock)).toEqual([]);
      expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    },
  );

  function noise(width: number, height: number, channels: 3 | 4) {
    let seed = 123;
    const bytes = new Uint8Array(width * height * channels);
    for (let index = 0; index < bytes.length; index++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      bytes[index] = seed & 255;
    }
    return sharp(bytes, { raw: { width, height, channels } });
  }

  it("steps JPEG quality down to fit 5 MB without shrinking pixels", async () => {
    const webp = await noise(2800, 2800, 3).webp({ quality: 50 }).toBuffer();
    expect(webp.byteLength).toBeLessThan(X_IMAGE_MAX_BYTES);
    expect(
      (await sharp(webp).jpeg({ quality: 90 }).toBuffer()).byteLength,
    ).toBeGreaterThan(X_IMAGE_MAX_BYTES);
    stubMediaSession();
    await publishXPost({
      ...imageInput,
      media: [mediaRef("image/webp", "image", { bytes: webp })],
    });
    const staged = ssrfSafeFetchMock.mock.calls[0][1].body;
    expect(staged.byteLength).toBeLessThanOrEqual(X_IMAGE_MAX_BYTES);
    expect(await sharp(staged).metadata()).toMatchObject({
      format: "jpeg",
      width: 2800,
      height: 2800,
      isProgressive: false,
    });
    expect(Buffer.from(staged)).toEqual(
      await sharp(webp).jpeg({ quality: 80 }).toBuffer(),
    );
  });

  it("rejects when every JPEG quality still exceeds 5 MB", async () => {
    const input = await noise(128, 128, 3).png().toBuffer();
    const bytes = await sharp({
      create: { width: 4000, height: 4000, channels: 3, background: "white" },
    })
      .composite([{ input, tile: true }])
      .removeAlpha()
      .png()
      .toBuffer();
    expect(bytes.byteLength).toBeLessThan(X_IMAGE_MAX_BYTES);
    expect(
      (await sharp(bytes).jpeg({ quality: 40 }).toBuffer()).byteLength,
    ).toBeGreaterThan(X_IMAGE_MAX_BYTES);
    const fetchMock = stubMediaSession();
    await expect(
      publishXPost({
        ...imageInput,
        media: [mediaRef("image/png", "image", { bytes })],
      }),
    ).rejects.toThrow("The converted image is larger than X's 5 MB limit.");
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(executeCalls(fetchMock)).toEqual([]);
  });

  it("rejects transparent PNG output above 5 MB without losing transparency", async () => {
    const webp = await noise(1200, 1200, 4).webp({ quality: 50 }).toBuffer();
    expect(webp.byteLength).toBeLessThan(X_IMAGE_MAX_BYTES);
    expect((await sharp(webp).png().toBuffer()).byteLength).toBeGreaterThan(
      X_IMAGE_MAX_BYTES,
    );
    const fetchMock = stubMediaSession();
    await expect(
      publishXPost({
        ...imageInput,
        media: [mediaRef("image/webp", "image", { bytes: webp })],
      }),
    ).rejects.toThrow("The converted image is larger than X's 5 MB limit.");
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(executeCalls(fetchMock)).toEqual([]);
  });

  it("normalizes an input of exactly 5 MB and strips trailing data", async () => {
    stubMediaSession();
    const bytes = new Uint8Array(X_IMAGE_MAX_BYTES);
    bytes.set(PNG_BYTES);
    await expect(
      publishXPost({
        ...imageInput,
        media: [mediaRef("image/png", "image", { bytes })],
      }),
    ).resolves.toEqual(xResult("1907"));
    expect(ssrfSafeFetchMock.mock.calls[0][1].body.byteLength).toBeLessThan(
      X_IMAGE_MAX_BYTES,
    );
  });

  it("keeps wide still-image dimensions without an invented pixel cap", async () => {
    stubMediaSession();
    const bytes = await sharp({
      create: { width: 20_000, height: 1, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(
      publishXPost({
        ...imageInput,
        media: [mediaRef("image/png", "image", { bytes })],
      }),
    ).resolves.toEqual(xResult("1907"));
    expect(
      await sharp(ssrfSafeFetchMock.mock.calls[0][1].body).metadata(),
    ).toMatchObject({ width: 20_000, height: 1 });
  });

  it("preserves the displayed orientation when converting WebP", async () => {
    stubMediaSession();
    const bytes = await sharp({
      create: { width: 3, height: 2, channels: 3, background: "white" },
    })
      .withMetadata({ orientation: 6 })
      .webp()
      .toBuffer();
    await publishXPost({
      ...imageInput,
      media: [mediaRef("image/webp", "image", { bytes })],
    });
    expect(
      await sharp(ssrfSafeFetchMock.mock.calls[0][1].body).metadata(),
    ).toMatchObject({ format: "jpeg", width: 2, height: 3 });
  });

  it("rejects animated WebP without silently uploading its first frame", async () => {
    const fetchMock = stubMediaSession();
    const pixels = new Uint8Array(2 * 4 * 3);
    pixels.fill(255, pixels.length / 2);
    const bytes = await sharp(pixels, {
      raw: { width: 2, height: 4, channels: 3, pageHeight: 2 },
    })
      .webp({ delay: [100, 100], loop: 0 })
      .toBuffer();
    expect((await sharp(bytes).metadata()).pages).toBe(2);
    await expect(
      publishXPost({
        ...imageInput,
        media: [mediaRef("image/webp", "image", { bytes })],
      }),
    ).rejects.toThrow("X image uploads need a still image");
    expect(ssrfSafeFetchMock).not.toHaveBeenCalled();
    expect(executeCalls(fetchMock)).toEqual([]);
  });

  it("polls processing before publishing and propagates cancellation into the wait", async () => {
    const controller = new AbortController();
    const fetchMock = stubMediaSession((call) => {
      if (call.tool_slug === "TWITTER_UPLOAD_LARGE_MEDIA") {
        queueMicrotask(() => controller.abort());
        return toolResponse({
          id: "media_1",
          processing_info: { state: "pending", check_after_secs: 120 },
        });
      }
      return toolResponse({ id: "1907" });
    });
    await expect(
      publishXPost({
        provider: "x" as const,
        connectedAccountId: "ca_123",
        externalAccountId: "x_123",
        externalHandle: null,
        executorUserId: "executor",
        text: "Clip",
        media: [mediaRef("video/mp4", "video")],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executeCalls(fetchMock).map((c) => c.tool_slug)).toEqual([
      "TWITTER_UPLOAD_LARGE_MEDIA",
    ]);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("waits for a processing result before sending the media id to X", async () => {
    const fetchMock = stubMediaSession((call) => {
      if (call.tool_slug === "TWITTER_UPLOAD_LARGE_MEDIA")
        return toolResponse({
          media_id_string: "media_1",
          processing_info: { state: "pending", check_after_secs: 0 },
        });
      if (call.tool_slug === "TWITTER_GET_MEDIA_UPLOAD_STATUS")
        return toolResponse({ processing_info: { state: "succeeded" } });
      return toolResponse({ id: "1907" });
    });
    await publishXPost({
      provider: "x" as const,
      connectedAccountId: "ca_123",
      externalAccountId: "x_123",
      externalHandle: null,
      executorUserId: "executor",
      text: "Clip",
      media: [mediaRef("video/mp4", "video")],
    });
    expect(executeCalls(fetchMock).map((c) => c.tool_slug)).toEqual([
      "TWITTER_UPLOAD_LARGE_MEDIA",
      "TWITTER_GET_MEDIA_UPLOAD_STATUS",
      "TWITTER_CREATION_OF_A_POST",
    ]);
  });

  it.each([true, false])(
    "requires confirmed processing when upload omits status (confirmed=%s)",
    async (confirmed) => {
      const fetchMock = stubMediaSession((call) => {
        if (call.tool_slug === "TWITTER_GET_MEDIA_UPLOAD_STATUS")
          return toolResponse(
            confirmed ? { processing_info: { state: "succeeded" } } : {},
          );
        return toolResponse({
          id:
            call.tool_slug === "TWITTER_CREATION_OF_A_POST"
              ? "1907"
              : "media_1",
        });
      });
      const result = publishXPost({
        provider: "x" as const,
        connectedAccountId: "ca_123",
        externalAccountId: "x_123",
        externalHandle: null,
        executorUserId: "executor",
        text: "Clip",
        media: [mediaRef("video/mp4", "video")],
      });
      if (confirmed) await expect(result).resolves.toEqual(xResult("1907"));
      else
        await expect(result).rejects.toThrow(
          "did not confirm media processing",
        );
      expect(
        executeCalls(fetchMock).some(
          (c) => c.tool_slug === "TWITTER_CREATION_OF_A_POST",
        ),
      ).toBe(confirmed);
    },
  );

  it("does not publish text alone when provider staging fails", async () => {
    const fetchMock = stubMediaSession();
    ssrfSafeFetchMock.mockResolvedValue(
      new Response("denied", { status: 403 }),
    );
    await expect(
      publishXPost({
        provider: "x" as const,
        connectedAccountId: "ca_123",
        externalAccountId: "x_123",
        externalHandle: null,
        executorUserId: "executor",
        text: "Pic",
        media: [mediaRef("image/png", "image")],
      }),
    ).rejects.toMatchObject({ httpStatus: 403 });
    expect(executeCalls(fetchMock)).toEqual([]);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("stops before creating a post when cancellation occurs during staging", async () => {
    const controller = new AbortController();
    const fetchMock = stubMediaSession();
    ssrfSafeFetchMock.mockImplementation(async () => {
      controller.abort();
      return new Response("");
    });
    await expect(
      publishXPost({
        provider: "x" as const,
        connectedAccountId: "ca_123",
        externalAccountId: "x_123",
        externalHandle: null,
        executorUserId: "executor",
        text: "Pic",
        media: [mediaRef("image/png", "image")],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executeCalls(fetchMock)).toEqual([]);
  });

  it("fails media processing without creating a post", async () => {
    const fetchMock = stubMediaSession(() =>
      toolResponse({
        id: "media_1",
        processing_info: {
          state: "failed",
          error: { message: "Invalid codec" },
        },
      }),
    );
    await expect(
      publishXPost({
        provider: "x" as const,
        connectedAccountId: "ca_123",
        externalAccountId: "x_123",
        externalHandle: null,
        executorUserId: "executor",
        text: "Pic",
        media: [mediaRef("video/mp4", "video")],
      }),
    ).rejects.toMatchObject({ providerMessage: "Invalid codec" });
    expect(executeCalls(fetchMock)).toHaveLength(1);
  });
});
