import { beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));

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
});

describe("publishXPost", () => {
  const publishInput = {
    connectedAccountId: "ca_123",
    executorUserId: "sokosumi:project-executor:project_123",
    text: "Hello world",
  };

  function stubSession(execute: () => Promise<Response> | Response) {
    const fetchMock = vi.fn(
      async (url: URL, init?: RequestInit): Promise<Response> => {
        const path = url.pathname;
        if (path === "/api/v3.1/tool_router/session") {
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
        toolkits: ["twitter"],
        connected_accounts: { twitter: ["ca_123"] },
        manage_connections: { enable: false, enable_connection_removal: false },
        tools: { twitter: { enable: ["TWITTER_CREATION_OF_A_POST"] } },
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
    const fetchMock = stubSession(
      () =>
        new Response(
          JSON.stringify({
            data: null,
            error: {
              message:
                "You are not allowed to create a Tweet with duplicate content.\nsession sess_1",
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
        "You are not allowed to create a Tweet with duplicate content. session sess_1",
      providerStatus: 403,
    });
    expect(error.message).not.toContain("sess_1");
    expect(calls(fetchMock).at(-1)).toMatchObject({
      path: "/api/v3.1/tool_router/session/sess_1",
      method: "DELETE",
    });
  });

  it("raises a tool error when no post id comes back", async () => {
    stubSession(() => new Response(JSON.stringify({ data: { text: "x" } })));
    const { ComposioToolError, publishXPost } = await import(
      "./composio.client"
    );

    await expect(publishXPost(publishInput)).rejects.toBeInstanceOf(
      ComposioToolError,
    );
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
