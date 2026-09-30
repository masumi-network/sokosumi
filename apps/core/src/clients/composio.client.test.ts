import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectedSocialIdentity } from "@/clients/composio.client";
import {
  PROJECT_SOCIAL_PROVIDERS,
  type ProjectSocialProvider,
} from "@/config/social-providers";

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

describe("initiateComposioConnection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      COMPOSIO_API_BASE_URL: "https://backend.composio.dev",
      COMPOSIO_API_KEY: "test-composio-key",
    });
  });

  it("creates a connector-owned shared link with only the project executor in its ACL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        connected_account_id: "ca_shared",
        redirect_url: "https://connect.composio.dev/shared-link",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { initiateComposioConnection } = await import("./composio.client");
    await initiateComposioConnection({
      ...input,
      authConfigId: "ac_instagram",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://backend.composio.dev/api/v3.1/connected_accounts/link"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      auth_config_id: "ac_instagram",
      user_id: input.connectorUserId,
      callback_url: input.callbackUrl,
      experimental: {
        account_type: "SHARED",
        acl_config_for_shared: { allowed_user_ids: [input.executorUserId] },
      },
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
            arguments: { user_fields: ["name", "profile_image_url"] },
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
    const { getConnectedSocialIdentity } = await import("./composio.client");
    await expect(
      getConnectedSocialIdentity({
        provider: "x",
        connectedAccountId: "ca_123",
        executorUserId: input.executorUserId,
      }),
    ).resolves.toMatchObject({ id: "x_123", handle: "alice" });
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
    const { initiateComposioConnection } = await import("./composio.client");
    await expect(initiateComposioConnection(input)).rejects.toMatchObject({
      httpStatus: 400,
      body: undefined,
    });
    expect(logSetMock).toHaveBeenCalledWith({
      composio: {
        operation: "initiate Project social connection",
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
    const { initiateComposioConnection } = await import("./composio.client");
    await expect(initiateComposioConnection(input)).rejects.toMatchObject({
      httpStatus: 422,
    });
    expect(logSetMock).toHaveBeenCalledWith({
      composio: {
        operation: "initiate Project social connection",
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
    const { initiateComposioConnection } = await import("./composio.client");
    await expect(initiateComposioConnection(input)).rejects.toMatchObject({
      httpStatus: 400,
    });
    expect(logSetMock).toHaveBeenCalledWith({
      composio: {
        operation: "initiate Project social connection",
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
    const { initiateComposioConnection } = await import("./composio.client");
    await expect(initiateComposioConnection(input)).rejects.toThrow(
      "COMPOSIO_API_KEY is not configured",
    );
    expect(logSetMock).toHaveBeenCalledWith({
      composio: {
        failure: "missing_configuration",
        apiKeyConfigured: false,
        authConfigsConfigured: {
          x: true,
          tiktok: false,
          instagram: false,
          linkedin: false,
          facebook: false,
          youtube: false,
        },
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
    const { initiateComposioConnection } = await import("./composio.client");

    await expect(initiateComposioConnection(input)).resolves.toEqual({
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
    const { ComposioApiError, initiateComposioConnection } = await import(
      "./composio.client"
    );

    await expect(initiateComposioConnection(input)).rejects.toMatchObject({
      constructor: ComposioApiError,
      httpStatus: 503,
    });
  });

  it("maps an upstream timeout to service unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")),
    );
    const { ComposioApiError, initiateComposioConnection } = await import(
      "./composio.client"
    );

    await expect(initiateComposioConnection(input)).rejects.toMatchObject({
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
      const { deleteProjectSocialConnectionIntent } = await import(
        "./composio.client"
      );
      await deleteProjectSocialConnectionIntent({
        connectedAccountId: "ca_123",
      });
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
      const { revokeComposioConnectedAccount } = await import(
        "./composio.client"
      );
      const result = revokeComposioConnectedAccount({
        connectedAccountId: "ca_123",
      });
      if (status === "REVOKED") await expect(result).resolves.toBeUndefined();
      else await expect(result).rejects.toMatchObject({ httpStatus: 409 });
    },
  );
});

describe("getConnectedSocialIdentity", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ COMPOSIO_API_KEY: "test-composio-key" });
  });

  const identities: {
    provider: ProjectSocialProvider;
    slug: string;
    args: Record<string, unknown>;
    payload: Record<string, unknown>;
    identity: ConnectedSocialIdentity;
  }[] = [
    {
      provider: "x",
      slug: "TWITTER_USER_LOOKUP_ME",
      args: { user_fields: ["name", "profile_image_url"] },
      payload: {
        data: {
          id: "x_123",
          username: "alice",
          name: "Alice Doe",
          profile_image_url:
            "https://pbs.twimg.com/profile_images/1/a_normal.jpg",
        },
      },
      identity: {
        id: "x_123",
        handle: "alice",
        displayName: "Alice Doe",
        avatarUrl: "https://pbs.twimg.com/profile_images/1/a_400x400.jpg",
      },
    },
    {
      provider: "tiktok",
      slug: "TIKTOK_GET_USER_STATS",
      args: { fields: ["open_id", "display_name", "avatar_url"] },
      payload: {
        data: {
          user: {
            open_id: "tt_123",
            display_name: "Alice",
            avatar_url: "https://p16.tiktokcdn.com/a.jpeg",
          },
        },
        error: { code: "ok", message: "", log_id: "private-log-id" },
      },
      identity: {
        id: "tt_123",
        handle: "Alice",
        displayName: "Alice",
        avatarUrl: "https://p16.tiktokcdn.com/a.jpeg",
      },
    },
    {
      provider: "instagram",
      slug: "INSTAGRAM_GET_USER_INFO",
      args: {
        ig_user_id: "me",
        fields: "id,username,name,profile_picture_url",
      },
      payload: {
        id: "17841400000000000",
        username: "alice",
        name: "Alice Doe",
        profile_picture_url: "https://scontent.cdninstagram.com/a.jpg",
      },
      identity: {
        id: "17841400000000000",
        handle: "alice",
        displayName: "Alice Doe",
        avatarUrl: "https://scontent.cdninstagram.com/a.jpg",
      },
    },
    {
      provider: "linkedin",
      slug: "LINKEDIN_GET_MY_INFO",
      args: {},
      payload: {
        response_dict: {
          author_id: "urn:li:person:alice",
          given_name: "Alice",
          family_name: "Doe",
          picture: "https://media.licdn.com/a.jpg",
        },
      },
      identity: {
        id: "urn:li:person:alice",
        handle: null,
        displayName: "Alice Doe",
        avatarUrl: "https://media.licdn.com/a.jpg",
      },
    },
    {
      provider: "facebook",
      slug: "FACEBOOK_LIST_MANAGED_PAGES",
      args: { fields: "id,name,picture", limit: 2 },
      payload: {
        data: [
          {
            id: "page_123",
            name: "Alice Studio",
            picture: { data: { url: "https://scontent.xx.fbcdn.net/a.jpg" } },
          },
        ],
      },
      identity: {
        id: "page_123",
        handle: "Alice Studio",
        displayName: "Alice Studio",
        avatarUrl: "https://scontent.xx.fbcdn.net/a.jpg",
      },
    },
    {
      provider: "youtube",
      slug: "YOUTUBE_LIST_CHANNELS",
      args: { mine: true, part: "id,snippet", maxResults: 2 },
      payload: {
        items: [
          {
            id: "UC_123",
            snippet: {
              customUrl: "@alice",
              title: "Alice Channel",
              thumbnails: { medium: { url: "https://yt3.ggpht.com/a.jpg" } },
            },
          },
        ],
      },
      identity: {
        id: "UC_123",
        handle: "@alice",
        displayName: "Alice Channel",
        avatarUrl: "https://yt3.ggpht.com/a.jpg",
      },
    },
  ];

  function stubIdentity(payload: unknown) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ session_id: "sess_identity" }))
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it.each(identities)(
    "looks up $provider through only its authenticated account and identity tool",
    async ({ provider, slug, args, payload, identity }) => {
      const fetchMock = stubIdentity({
        data: { data: payload, successful: true },
        error: null,
      });
      const { getConnectedSocialIdentity } = await import("./composio.client");
      await expect(
        getConnectedSocialIdentity({
          provider,
          connectedAccountId: "ca_selected",
          executorUserId: input.executorUserId,
        }),
      ).resolves.toEqual(identity);

      const toolkit = PROJECT_SOCIAL_PROVIDERS[provider].toolkitSlug;
      expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
        user_id: input.executorUserId,
        toolkits: { enable: [toolkit] },
        connected_accounts: { [toolkit]: ["ca_selected"] },
        manage_connections: { enable: false, enable_connection_removal: false },
        tools: { [toolkit]: { enable: [slug] } },
        workbench: { enable: false, enable_proxy_execution: false },
        search: { enable: false },
        execute: { enable_multi_execute: false },
      });
      expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toEqual({
        tool_slug: slug,
        arguments: args,
      });
      expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it.each(identities)(
    "rejects a refused $provider lookup even if an identity is present",
    async ({ provider, payload }) => {
      const fetchMock = stubIdentity({
        data: { data: payload, successful: false },
        error: null,
      });
      const { getConnectedSocialIdentity } = await import("./composio.client");
      await expect(
        getConnectedSocialIdentity({
          provider,
          connectedAccountId: "ca_selected",
          executorUserId: input.executorUserId,
        }),
      ).rejects.toMatchObject({ name: "ComposioApiError", body: undefined });
      expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
    },
  );

  it.each([
    { provider: "x", payload: { id: 123, username: "alice" } },
    { provider: "tiktok", payload: { user: { open_id: " " } } },
    { provider: "instagram", payload: { user_id: "17841400000000000" } },
    {
      provider: "linkedin",
      payload: { name: "Alice", email: "alice@example.com" },
    },
    { provider: "facebook", payload: { data: [] } },
    {
      provider: "facebook",
      payload: {
        data: [
          { id: "page_one", name: "One" },
          { id: "page_two", name: "Two" },
        ],
      },
    },
    {
      provider: "facebook",
      payload: { data: [{ id: "", name: "Alice" }] },
    },
    {
      provider: "facebook",
      payload: {
        data: [{ id: "page_one", name: "One" }],
        paging: { next: "https://backend.composio.dev/next" },
      },
    },
    { provider: "youtube", payload: { items: [] } },
    {
      provider: "youtube",
      payload: { items: [{ id: "UC_one" }, { id: "UC_two" }] },
    },
    {
      provider: "youtube",
      payload: { items: [{ id: "UC_one" }], nextPageToken: "more" },
    },
    { provider: "youtube", payload: { items: [{ id: 123 }] } },
  ] satisfies { provider: ProjectSocialProvider; payload: unknown }[])(
    "rejects malformed or ambiguous $provider identities: $payload",
    async ({ provider, payload }) => {
      const fetchMock = stubIdentity({ data: { data: payload } });
      const { getConnectedSocialIdentity } = await import("./composio.client");
      await expect(
        getConnectedSocialIdentity({
          provider,
          connectedAccountId: "ca_selected",
          executorUserId: input.executorUserId,
        }),
      ).rejects.toMatchObject(
        provider === "facebook"
          ? {
              name: "ComposioIdentityError",
              kind: "social_facebook_page_required",
            }
          : { name: "ComposioApiError" },
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    null,
    [],
    "invalid-json",
    { data: { id: "x_123" }, error: "access_token=private-token" },
    { data: { error: { message: "private-token" }, data: { id: "x_123" } } },
  ])(
    "rejects invalid or failed envelopes without retaining payload: %j",
    async (payload) => {
      stubIdentity(payload);
      const { getConnectedSocialIdentity } = await import("./composio.client");
      await expect(
        getConnectedSocialIdentity({
          provider: "x",
          connectedAccountId: "ca_selected",
          executorUserId: input.executorUserId,
        }),
      ).rejects.toMatchObject({
        name: "ComposioApiError",
        message: "X identity lookup failed",
        body: undefined,
      });
      expect(JSON.stringify(logSetMock.mock.calls)).not.toContain(
        "private-token",
      );
    },
  );

  it("rejects TikTok provider errors despite a returned user", async () => {
    stubIdentity({
      data: {
        data: { user: { open_id: "tt_123" } },
        error: {
          code: "scope_not_authorized",
          message: "private-provider-message",
        },
      },
    });
    const { getConnectedSocialIdentity } = await import("./composio.client");
    await expect(
      getConnectedSocialIdentity({
        provider: "tiktok",
        connectedAccountId: "ca_selected",
        executorUserId: input.executorUserId,
      }),
    ).rejects.toMatchObject({ name: "ComposioApiError", body: undefined });
  });

  it.each([
    {
      provider: "tiktok",
      payload: { user: { open_id: "tt_123" } },
      id: "tt_123",
    },
    {
      provider: "linkedin",
      payload: { sub: "li_123", name: "Alice" },
      id: "li_123",
      handle: "Alice",
    },
    {
      provider: "linkedin",
      payload: { id: "li_123", vanityName: "alice" },
      id: "li_123",
      handle: "alice",
    },
    {
      provider: "youtube",
      payload: { items: [{ id: "UC_123", snippet: { title: "Alice" } }] },
      id: "UC_123",
      handle: "Alice",
    },
  ] satisfies {
    provider: ProjectSocialProvider;
    payload: unknown;
    id: string;
    handle?: string;
  }[])(
    "accepts $provider identity with an optional public handle or display name",
    async ({ provider, payload, id, handle }) => {
      stubIdentity({ data: { data: JSON.stringify(payload) } });
      const { getConnectedSocialIdentity } = await import("./composio.client");
      await expect(
        getConnectedSocialIdentity({
          provider,
          connectedAccountId: "ca_selected",
          executorUserId: input.executorUserId,
        }),
      ).resolves.toMatchObject({ id, handle: handle ?? null });
    },
  );

  it.each([null, { session_id: "" }, { session_id: 123 }])(
    "rejects invalid session metadata before tool execution: %j",
    async (metadata) => {
      const fetchMock = vi.fn().mockResolvedValue(Response.json(metadata));
      vi.stubGlobal("fetch", fetchMock);
      const { getConnectedSocialIdentity } = await import("./composio.client");
      await expect(
        getConnectedSocialIdentity({
          provider: "x",
          connectedAccountId: "ca_selected",
          executorUserId: input.executorUserId,
        }),
      ).rejects.toMatchObject({ name: "ComposioApiError" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves identity when cleanup fails without logging transport secrets", async () => {
    const fetchMock = stubIdentity({ data: { id: "fb_123" } });
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(Response.json({ session_id: "sess_identity" }))
      .mockResolvedValueOnce(
        Response.json({ data: { data: [{ id: "page_123", name: "Alice" }] } }),
      )
      .mockRejectedValueOnce(new Error("private-token private-session-url"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getConnectedSocialIdentity } = await import("./composio.client");
    await expect(
      getConnectedSocialIdentity({
        provider: "facebook",
        connectedAccountId: "ca_selected",
        executorUserId: input.executorUserId,
      }),
    ).resolves.toMatchObject({ id: "page_123", handle: "Alice" });
    expect(warn).toHaveBeenCalledWith(
      "[composio] delete Project Facebook identity session failed",
    );
    warn.mockRestore();
  });

  it("sanitizes execute transport failures and deletes the identity session", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ session_id: "sess_identity" }))
      .mockRejectedValueOnce(new Error("Bearer private-token private-url"))
      .mockResolvedValueOnce(Response.json({}));
    vi.stubGlobal("fetch", fetchMock);
    const { getConnectedSocialIdentity } = await import("./composio.client");
    await expect(
      getConnectedSocialIdentity({
        provider: "x",
        connectedAccountId: "ca_selected",
        executorUserId: input.executorUserId,
      }),
    ).rejects.toMatchObject({
      name: "ComposioApiError",
      message: "Composio API request failed",
      httpStatus: 503,
      body: undefined,
    });
    expect(fetchMock.mock.calls[2][1].method).toBe("DELETE");
  });
});
