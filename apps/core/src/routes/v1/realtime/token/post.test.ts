import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountCreateAblyToken from "./post";

const { createTokenRequestMock, getSubscribeRestClientMock } = vi.hoisted(
  () => ({
    createTokenRequestMock: vi.fn(),
    getSubscribeRestClientMock: vi.fn(),
  }),
);

vi.mock("@/lib/ably/client", () => ({
  getSubscribeRestClient: getSubscribeRestClientMock,
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: "ven_123",
};

function createTokenRequest(overrides: Record<string, unknown> = {}) {
  return {
    keyName: "abcdef.ghijkl",
    clientId: "user_123",
    ttl: 3_600_000,
    timestamp: 1_754_400_000_000,
    capability: '{"chat_rooms:*:user_123":["subscribe"]}',
    nonce: "1a2b3c4d5e6f7g8h",
    mac: "9x8y7z6w5v4u3t2s1r=",
    ...overrides,
  };
}

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  mountCreateAblyToken(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /realtime/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTokenRequestMock.mockResolvedValue(createTokenRequest());
    getSubscribeRestClientMock.mockReturnValue({
      auth: { createTokenRequest: createTokenRequestMock },
    });
  });

  it("returns a token request for the authenticated user", async () => {
    const response = await createApp().request("/token", { method: "POST" });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { clientId: string } };
    expect(body.data.clientId).toBe("user_123");
  });

  it("scopes the capability to the caller's four channels, subscribe-only", async () => {
    await createApp().request("/token", { method: "POST" });

    expect(createTokenRequestMock).toHaveBeenCalledTimes(1);
    const [args] = createTokenRequestMock.mock.calls[0] as [
      { clientId: string; capability: Record<string, string[]>; ttl: number },
    ];

    expect(args.clientId).toBe("user_123");
    expect(args.ttl).toBe(60 * 60 * 1000);
    expect(args.capability).toEqual({
      "agent_jobs:*:user_user_123": ["subscribe"],
      "tasks:*:user_user_123": ["subscribe"],
      "notifications:*:user_user_123": ["subscribe"],
      "chat_rooms:*:user_user_123": ["subscribe"],
    });

    // No capability may exceed subscribe — the signing key is subscribe-only
    // and Ably would reject the request, but assert it here so a widened
    // capability fails in CI rather than at runtime.
    for (const operations of Object.values(args.capability)) {
      expect(operations).toEqual(["subscribe"]);
    }
  });

  it("never mints a token for another user's channels", async () => {
    await createApp({ ...USER_AUTH_CONTEXT, userId: "user_456" }).request(
      "/token",
      { method: "POST" },
    );

    const [args] = createTokenRequestMock.mock.calls[0] as [
      { capability: Record<string, string[]> },
    ];

    for (const channel of Object.keys(args.capability)) {
      expect(channel).toContain("user_456");
      expect(channel).not.toContain("user_123");
    }
  });

  it("rejects non-user actors", async () => {
    const response = await createApp(COWORKER_AUTH_CONTEXT).request("/token", {
      method: "POST",
    });

    expect(response.status).toBe(403);
    expect(createTokenRequestMock).not.toHaveBeenCalled();
  });
});
