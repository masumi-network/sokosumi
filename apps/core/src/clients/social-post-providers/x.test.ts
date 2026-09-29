import {
  SOCIAL_POST_MEDIA_RULES,
  type SocialPostMediaKind,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposioApiError } from "@/clients/composio.client";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/social-post-providers/tools";
import { publishXPost } from "@/clients/social-post-providers/x";

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
      bytes: options.bytes ?? new Uint8Array([1]),
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
  const COMPOSIO_TOOL_MIME_TYPES: Record<
    "TWITTER_UPLOAD_MEDIA" | "TWITTER_UPLOAD_LARGE_MEDIA",
    readonly string[]
  > = {
    TWITTER_UPLOAD_MEDIA: ["image/jpeg", "image/png", "image/webp"],
    TWITTER_UPLOAD_LARGE_MEDIA: [
      "video/mp4",
      "video/webm",
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ],
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

  it("keeps every accepted MIME type within its selected Composio tool contract", () => {
    const rules = SOCIAL_POST_MEDIA_RULES.x;
    for (const mimeType of rules.imageMimeTypes) {
      expect(COMPOSIO_TOOL_MIME_TYPES.TWITTER_UPLOAD_MEDIA).toContain(mimeType);
    }
    for (const mimeType of [...rules.gifMimeTypes, ...rules.videoMimeTypes]) {
      expect(COMPOSIO_TOOL_MIME_TYPES.TWITTER_UPLOAD_LARGE_MEDIA).toContain(
        mimeType,
      );
    }
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
      const bytes = new Uint8Array([0, 128, 255]);
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
        filename: "original-file",
        mimetype: mimeType,
        md5: expect.stringMatching(/^[a-f0-9]{32}$/),
      });
      expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
        "https://uploads.example.com/media?signed=token",
        expect.objectContaining({
          method: "PUT",
          body: bytes,
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
              name: "original-file",
              mimetype: mimeType,
              s3key: "staged-media",
            },
            media_category: category,
          },
        },
        {
          tool_slug: "TWITTER_CREATION_OF_A_POST",
          arguments: { media_media_ids: ["media_1"] },
        },
      ]);
    },
  );

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
