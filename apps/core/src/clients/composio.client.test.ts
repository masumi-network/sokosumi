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
