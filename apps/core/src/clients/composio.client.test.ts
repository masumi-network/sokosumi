import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock, logSetMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  logSetMock: vi.fn(),
}));

vi.mock("@/lib/evlog", () => ({ tryUseLogger: () => ({ set: logSetMock }) }));

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
            enable: [
              "TWITTER_INITIALIZE_MEDIA_UPLOAD",
              "TWITTER_APPEND_MEDIA_UPLOAD",
              "TWITTER_FINALIZE_MEDIA_UPLOAD",
              "TWITTER_GET_MEDIA_UPLOAD_STATUS",
              "TWITTER_CREATION_OF_A_POST",
            ],
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
  const CHUNK_BYTES = 4 * 1024 * 1024;

  interface ExecuteCall {
    tool_slug: string;
    arguments: Record<string, unknown>;
  }

  function toolResponse(data: unknown, extra: Record<string, unknown> = {}) {
    return new Response(
      JSON.stringify({ data, error: null, successful: true, ...extra }),
    );
  }

  function stubMediaSession(
    execute: (call: ExecuteCall, index: number) => Response,
  ) {
    let index = 0;
    const fetchMock = vi.fn(
      async (url: URL, init?: RequestInit): Promise<Response> => {
        const path = url.pathname;
        if (path === "/api/v3.1/tool_router/session") {
          return new Response(JSON.stringify({ session_id: "sess_1" }));
        }
        if (path.endsWith("/execute")) {
          const body = JSON.parse(String(init?.body)) as ExecuteCall;
          return execute(body, index++);
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

  function executeCalls(fetchMock: ReturnType<typeof stubMediaSession>) {
    return fetchMock.mock.calls
      .filter(([url]) => url.pathname.endsWith("/execute"))
      .map(([, init]) => JSON.parse(String(init?.body)) as ExecuteCall);
  }

  function defaultExecute(call: ExecuteCall): Response {
    switch (call.tool_slug) {
      case "TWITTER_INITIALIZE_MEDIA_UPLOAD":
        return toolResponse({ data: { id: "media_1", media_key: "3_1" } });
      case "TWITTER_APPEND_MEDIA_UPLOAD":
        return toolResponse({});
      case "TWITTER_FINALIZE_MEDIA_UPLOAD":
        return toolResponse({ data: { id: "media_1" } });
      case "TWITTER_CREATION_OF_A_POST":
        return toolResponse({ data: { id: "1907" } });
      default:
        throw new Error(`unexpected tool ${call.tool_slug}`);
    }
  }

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("uploads an image in two chunks and posts with its media id", async () => {
    const fetchMock = stubMediaSession(defaultExecute);
    const bytes = new Uint8Array(CHUNK_BYTES + 10);
    bytes.fill(7, 0, CHUNK_BYTES);
    bytes.fill(9, CHUNK_BYTES);
    const { publishXPost } = await import("./composio.client");

    await expect(
      publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "sokosumi:project-executor:project_123",
        text: "With picture",
        media: [{ bytes, mimeType: "image/png", kind: "image" }],
      }),
    ).resolves.toEqual({ externalId: "1907" });

    const calls = executeCalls(fetchMock);
    expect(calls.map((call) => call.tool_slug)).toEqual([
      "TWITTER_INITIALIZE_MEDIA_UPLOAD",
      "TWITTER_APPEND_MEDIA_UPLOAD",
      "TWITTER_APPEND_MEDIA_UPLOAD",
      "TWITTER_FINALIZE_MEDIA_UPLOAD",
      "TWITTER_CREATION_OF_A_POST",
    ]);
    expect(calls[0].arguments).toEqual({
      media_type: "image/png",
      total_bytes: bytes.length,
      media_category: "tweet_image",
    });
    expect(calls[1].arguments).toEqual({
      id: "media_1",
      media: Buffer.from(bytes.subarray(0, CHUNK_BYTES)).toString("base64"),
      segment_index: 0,
    });
    expect(calls[2].arguments).toEqual({
      id: "media_1",
      media: Buffer.from(bytes.subarray(CHUNK_BYTES)).toString("base64"),
      segment_index: 1,
    });
    expect(calls[3].arguments).toEqual({ id: "media_1" });
    expect(calls[4].arguments).toEqual({
      text: "With picture",
      media_media_ids: ["media_1"],
    });
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "DELETE",
    });
  });

  it("polls a video until processing succeeds and omits empty text", async () => {
    let statusPolls = 0;
    const fetchMock = stubMediaSession((call) => {
      switch (call.tool_slug) {
        case "TWITTER_INITIALIZE_MEDIA_UPLOAD":
          return toolResponse({ data: { media_id_string: "vid_1" } });
        case "TWITTER_FINALIZE_MEDIA_UPLOAD":
          return toolResponse({
            data: {
              id: "vid_1",
              processing_info: { state: "pending", check_after_secs: 0 },
            },
          });
        case "TWITTER_GET_MEDIA_UPLOAD_STATUS":
          statusPolls += 1;
          return toolResponse({
            data: {
              id: "vid_1",
              processing_info:
                statusPolls === 1
                  ? { state: "in_progress", check_after_secs: 0 }
                  : { state: "succeeded" },
            },
          });
        default:
          return defaultExecute(call);
      }
    });
    const { publishXPost } = await import("./composio.client");

    await expect(
      publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "sokosumi:project-executor:project_123",
        text: "",
        media: [
          { bytes: new Uint8Array(16), mimeType: "video/mp4", kind: "video" },
        ],
      }),
    ).resolves.toEqual({ externalId: "1907" });

    const calls = executeCalls(fetchMock);
    expect(calls[0].arguments).toMatchObject({ media_category: "tweet_video" });
    expect(
      calls.filter((c) => c.tool_slug === "TWITTER_GET_MEDIA_UPLOAD_STATUS"),
    ).toHaveLength(2);
    expect(calls.at(-2)?.arguments).toEqual({ media_id: "vid_1" });
    expect(calls.at(-1)?.arguments).toEqual({ media_media_ids: ["vid_1"] });
  });

  it("retries finalize with media_id when the tool rejects id", async () => {
    let finalizeCalls = 0;
    const fetchMock = stubMediaSession((call) => {
      if (call.tool_slug === "TWITTER_FINALIZE_MEDIA_UPLOAD") {
        finalizeCalls += 1;
        if (finalizeCalls === 1) {
          return new Response(
            JSON.stringify({
              data: null,
              error: { message: "Unknown argument: id", status: 400 },
              successful: false,
            }),
          );
        }
        return toolResponse({ data: { id: "gif_1" } });
      }
      if (call.tool_slug === "TWITTER_INITIALIZE_MEDIA_UPLOAD") {
        return toolResponse({ data: { media_id: 42 } });
      }
      return defaultExecute(call);
    });
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { publishXPost } = await import("./composio.client");

    await expect(
      publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "sokosumi:project-executor:project_123",
        text: "Gif",
        media: [
          { bytes: new Uint8Array(8), mimeType: "image/gif", kind: "gif" },
        ],
      }),
    ).resolves.toEqual({ externalId: "1907" });

    const finalize = executeCalls(fetchMock).filter(
      (c) => c.tool_slug === "TWITTER_FINALIZE_MEDIA_UPLOAD",
    );
    expect(finalize.map((c) => c.arguments)).toEqual([
      { id: "42" },
      { media_id: "42" },
    ]);
    expect(executeCalls(fetchMock)[0].arguments).toMatchObject({
      media_category: "tweet_gif",
    });
  });

  it("surfaces a failed media processing state as a tool error and deletes the session", async () => {
    const fetchMock = stubMediaSession((call) => {
      if (call.tool_slug === "TWITTER_FINALIZE_MEDIA_UPLOAD") {
        return toolResponse({
          data: {
            id: "vid_1",
            processing_info: {
              state: "failed",
              error: { message: "Invalid video codec" },
            },
          },
        });
      }
      return defaultExecute(call);
    });
    const { ComposioToolError, publishXPost } = await import(
      "./composio.client"
    );

    const error = await publishXPost({
      connectedAccountId: "ca_123",
      executorUserId: "sokosumi:project-executor:project_123",
      text: "Clip",
      media: [
        { bytes: new Uint8Array(8), mimeType: "video/mp4", kind: "video" },
      ],
    }).catch((e) => e);

    expect(error).toBeInstanceOf(ComposioToolError);
    expect(error).toMatchObject({ providerMessage: "Invalid video codec" });
    expect(
      executeCalls(fetchMock).some(
        (c) => c.tool_slug === "TWITTER_CREATION_OF_A_POST",
      ),
    ).toBe(false);
    expect(fetchMock.mock.calls.at(-1)?.[1]).toMatchObject({
      method: "DELETE",
    });
  });

  it("surfaces an append refusal as a tool error", async () => {
    stubMediaSession((call) => {
      if (call.tool_slug === "TWITTER_APPEND_MEDIA_UPLOAD") {
        return new Response(
          JSON.stringify({
            data: null,
            error: { message: "Media too large", status: 413 },
            successful: false,
          }),
        );
      }
      return defaultExecute(call);
    });
    const { ComposioToolError, publishXPost } = await import(
      "./composio.client"
    );

    await expect(
      publishXPost({
        connectedAccountId: "ca_123",
        executorUserId: "sokosumi:project-executor:project_123",
        text: "Pic",
        media: [
          { bytes: new Uint8Array(8), mimeType: "image/png", kind: "image" },
        ],
      }),
    ).rejects.toMatchObject({
      constructor: ComposioToolError,
      providerMessage: "Media too large",
      providerStatus: 413,
    });
  });
});
