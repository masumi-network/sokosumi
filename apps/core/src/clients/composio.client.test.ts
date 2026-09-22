import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock, logSetMock, ssrfSafeFetchMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  logSetMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
}));

vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => ({ set: logSetMock }) }));
vi.mock("@sokosumi/net", () => ({ ssrfSafeFetch: ssrfSafeFetchMock }));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));

const input = {
  authConfigId: "ac_x",
  callbackUrl: "https://app.sokosumi.com/composio/callback",
  connectorUserId: "sokosumi:user:user_123",
  executorUserId: "sokosumi:project-executor:project_123",
};

describe("initiateProjectXConnection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("creates a restricted identity session using the REST toolkit allowlist", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (request: URL, init: RequestInit) => {
        const url = request.toString();
        if (url.endsWith("/session")) {
          const body = JSON.parse(String(init.body));
          // REST requires an enable/disable object; the SDK array shorthand is invalid.
          if (Array.isArray(body.toolkits)) {
            return Response.json(
              { error: "Invalid toolkits" },
              { status: 400 },
            );
          }
          expect(body).toEqual({
            user_id: input.executorUserId,
            toolkits: { enable: ["twitter"] },
            connected_accounts: { twitter: ["ca_123"] },
            manage_connections: {
              enable: false,
              enable_connection_removal: false,
            },
            tools: { twitter: { enable: ["TWITTER_USER_LOOKUP_ME"] } },
            workbench: { enable: false, enable_proxy_execution: false },
            search: { enable: false },
            execute: { enable_multi_execute: false },
          });
          return Response.json({ session_id: "trs_123" }, { status: 201 });
        }
        if (url.endsWith("/trs_123/execute")) {
          expect(JSON.parse(String(init.body))).toEqual({
            tool_slug: "TWITTER_USER_LOOKUP_ME",
            arguments: {},
          });
          return Response.json({
            data: { data: { id: "x_123", username: "alice" } },
            error: null,
          });
        }
        expect(url).toBe(
          "https://backend.composio.dev/api/v3.1/tool_router/session/trs_123",
        );
        expect(init.method).toBe("DELETE");
        return Response.json({});
      });
    vi.stubGlobal("fetch", fetchMock);
    const { getConnectedXIdentity } = await import("./composio.client");
    await expect(
      getConnectedXIdentity({
        connectedAccountId: "ca_123",
        executorUserId: input.executorUserId,
      }),
    ).resolves.toEqual({ id: "x_123", handle: "alice" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("logs safe rejection labels without retaining provider secrets", async () => {
    const secrets = [
      "test-composio-key",
      "private-session-token",
      "alice@example.com",
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: `Auth config not found: '${secrets[0]}' ${secrets[1]} ${secrets[2]}`,
              credentials: secrets,
            },
            request: {
              callback_url: `https://example.com/?token=${secrets[1]}`,
            },
          }),
          { status: 400 },
        ),
      ),
    );
    const { initiateProjectXConnection } = await import("./composio.client");
    await expect(initiateProjectXConnection(input)).rejects.toMatchObject({
      httpStatus: 400,
      body: undefined,
    });
    expect(logSetMock).toHaveBeenCalledWith({
      composio: {
        operation: "initiate Project X connection",
        failure: "http_error",
        upstreamStatus: 400,
        fields: ["auth_config_id"],
        reasons: ["not_found"],
      },
    });
    for (const secret of secrets)
      expect(JSON.stringify(logSetMock.mock.calls)).not.toContain(secret);
  });

  it("records validation field names but not rejected values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: [
              {
                loc: ["body", "callback_url"],
                msg: "Invalid value",
                input: "https://private.example/token",
              },
            ],
          }),
          { status: 422 },
        ),
      ),
    );
    const { initiateProjectXConnection } = await import("./composio.client");
    await expect(initiateProjectXConnection(input)).rejects.toMatchObject({
      httpStatus: 422,
    });
    expect(logSetMock).toHaveBeenCalledWith({
      composio: {
        operation: "initiate Project X connection",
        failure: "http_error",
        upstreamStatus: 422,
        fields: ["callback_url"],
        reasons: ["invalid"],
      },
    });
    expect(JSON.stringify(logSetMock.mock.calls)).not.toContain(
      "private.example",
    );
  });

  it("does not log arbitrary text from non-JSON failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("secret-provider-response", { status: 400 }),
        ),
    );
    const { initiateProjectXConnection } = await import("./composio.client");
    await expect(initiateProjectXConnection(input)).rejects.toMatchObject({
      httpStatus: 400,
    });
    expect(logSetMock).toHaveBeenCalledWith({
      composio: {
        operation: "initiate Project X connection",
        failure: "http_error",
        upstreamStatus: 400,
        fields: [],
        reasons: [],
      },
    });
  });

  it("identifies missing configuration by presence only", async () => {
    getEnvMock.mockReturnValue({
      COMPOSIO_X_AUTH_CONFIG_ID: "private-config-id",
    });
    const { initiateProjectXConnection } = await import("./composio.client");
    await expect(initiateProjectXConnection(input)).rejects.toThrow(
      "COMPOSIO_API_KEY is not configured",
    );
    expect(logSetMock).toHaveBeenCalledWith({
      composio: {
        failure: "missing_configuration",
        apiKeyConfigured: false,
        xAuthConfigConfigured: true,
      },
    });
  });

  it.each([
    "https://backend.composio.dev/link-token",
    "https://connect.composio.dev/link-token",
  ])("accepts a hosted HTTPS redirect URL: %s", async (redirectUrl) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            connected_account_id: "ca_123",
            redirect_url: redirectUrl,
          }),
        ),
      ),
    );
    const { initiateProjectXConnection } = await import("./composio.client");

    await expect(initiateProjectXConnection(input)).resolves.toEqual({
      connectionId: "ca_123",
      redirectUrl,
    });
  });

  it.each([
    "http://connect.composio.dev/link-token",
    "https://unexpected.example/link-token",
    "javascript:alert(1)",
  ])("rejects an unsafe redirect URL: %s", async (redirectUrl) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            connected_account_id: "ca_123",
            redirect_url: redirectUrl,
          }),
        ),
      ),
    );
    const { ComposioApiError, initiateProjectXConnection } = await import(
      "./composio.client"
    );

    await expect(initiateProjectXConnection(input)).rejects.toMatchObject({
      constructor: ComposioApiError,
      httpStatus: 503,
    });
  });

  it("maps an upstream timeout to service unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")),
    );
    const { ComposioApiError, initiateProjectXConnection } = await import(
      "./composio.client"
    );

    await expect(initiateProjectXConnection(input)).rejects.toMatchObject({
      constructor: ComposioApiError,
      httpStatus: 503,
    });
  });
  it.each([200, 404])(
    "permanently deletes unfinished accounts idempotently (%s)",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("{}", { status }));
      vi.stubGlobal("fetch", fetchMock);
      const { deleteProjectXConnectionIntent } = await import(
        "./composio.client"
      );
      await deleteProjectXConnectionIntent({ connectedAccountId: "ca_123" });
      expect(fetchMock).toHaveBeenCalledWith(
        new URL(
          "https://backend.composio.dev/api/v3.1/connected_accounts/ca_123?revoke_on_delete=true",
        ),
        expect.objectContaining({ method: "DELETE" }),
      );
    },
  );

  it.each(["REVOKED", "ACTIVE"])(
    "verifies account status after a revoke conflict (%s)",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(new Response("{}", { status: 409 }))
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                id: "ca_123",
                status,
                toolkit: { slug: "twitter" },
                auth_config: { id: "ac_x" },
              }),
            ),
          ),
      );
      const { revokeProjectXConnection } = await import("./composio.client");
      const result = revokeProjectXConnection({ connectedAccountId: "ca_123" });
      if (status === "REVOKED") await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toMatchObject({ httpStatus: 409 });
    },
  );
});

describe("publishXPost", () => {
  const publishInput = {
    connectedAccountId: "ca_123",
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
    const { publishXPost } = await import("./composio.client");

    await expect(publishXPost(publishInput)).resolves.toEqual({
      externalId: "1907",
    });

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
    const { publishXPost } = await import("./composio.client");

    await expect(publishXPost(publishInput)).resolves.toEqual({
      externalId: "1907",
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("parses a flat tool result", async () => {
    stubSession(
      () => new Response(JSON.stringify({ data: { id: "42" }, error: null })),
    );
    const { publishXPost } = await import("./composio.client");

    await expect(publishXPost(publishInput)).resolves.toEqual({
      externalId: "42",
    });
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
    const { ComposioToolError, publishXPost } = await import(
      "./composio.client"
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
    const { ComposioPublishOutcomeUnknownError, publishXPost } = await import(
      "./composio.client"
    );

    await expect(publishXPost(publishInput)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
  });

  it("does not allow automatic retries after a create-post transport timeout", async () => {
    stubSession(() => {
      throw new DOMException("Timed out", "TimeoutError");
    });
    const { ComposioPublishOutcomeUnknownError, publishXPost } = await import(
      "./composio.client"
    );
    await expect(publishXPost(publishInput)).rejects.toBeInstanceOf(
      ComposioPublishOutcomeUnknownError,
    );
  });

  it.each([500, 502, 503])(
    "treats create-post HTTP %s as an uncertain external outcome",
    async (status) => {
      stubSession(() => new Response("unavailable", { status }));
      const { ComposioPublishOutcomeUnknownError, publishXPost } = await import(
        "./composio.client"
      );
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
    const { ComposioApiError, publishXPost } = await import(
      "./composio.client"
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
    const { ComposioApiError, publishXPost } = await import(
      "./composio.client"
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
      const { publishXPost } = await import("./composio.client");
      await expect(
        publishXPost({
          connectedAccountId: "ca_123",
          executorUserId: "executor",
          text: "",
          media: [{ bytes, name: "original-file", mimeType, kind }],
          signal,
        }),
      ).resolves.toEqual({ externalId: "1907" });
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
    const { publishXPost } = await import("./composio.client");
    await expect(
      publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "executor",
        text: "Clip",
        media: [
          { bytes: new Uint8Array([1]), mimeType: "video/mp4", kind: "video" },
        ],
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
    const { publishXPost } = await import("./composio.client");
    await publishXPost({
      connectedAccountId: "ca_123",
      executorUserId: "executor",
      text: "Clip",
      media: [
        { bytes: new Uint8Array([1]), mimeType: "video/mp4", kind: "video" },
      ],
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
      const { publishXPost } = await import("./composio.client");
      const result = publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "executor",
        text: "Clip",
        media: [
          { bytes: new Uint8Array([1]), mimeType: "video/mp4", kind: "video" },
        ],
      });
      if (confirmed)
        await expect(result).resolves.toEqual({ externalId: "1907" });
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
    const { publishXPost } = await import("./composio.client");
    await expect(
      publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "executor",
        text: "Pic",
        media: [
          { bytes: new Uint8Array([1]), mimeType: "image/png", kind: "image" },
        ],
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
    const { publishXPost } = await import("./composio.client");
    await expect(
      publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "executor",
        text: "Pic",
        media: [
          { bytes: new Uint8Array([1]), mimeType: "image/png", kind: "image" },
        ],
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
    const { publishXPost } = await import("./composio.client");
    await expect(
      publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "executor",
        text: "Pic",
        media: [
          { bytes: new Uint8Array([1]), mimeType: "video/mp4", kind: "video" },
        ],
      }),
    ).rejects.toMatchObject({ providerMessage: "Invalid codec" });
    expect(executeCalls(fetchMock)).toHaveLength(1);
  });
});
