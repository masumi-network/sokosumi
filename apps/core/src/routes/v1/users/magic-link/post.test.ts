import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

const { signInMagicLinkMock, userFindUniqueMock } = vi.hoisted(() => ({
  signInMagicLinkMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BETTER_AUTH_URL: "https://auth.example.com",
    BETTER_AUTH_TRUSTED_ORIGIN: "https://app.example.com",
  }),
  getWebAppBaseUrl: () => "https://app.example.com",
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      signInMagicLink: signInMagicLinkMock,
    },
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

const COWORKER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
};

let mountPostUsersMagicLink: (app: OpenAPIHonoWithAuth) => void;

function createApp(authContext: AuthenticationContext = COWORKER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("requestId", "req_123");

    return await next();
  });

  mountPostUsersMagicLink(app as unknown as OpenAPIHonoWithAuth);

  return app;
}

describe("POST /users/magic-link", () => {
  beforeAll(async () => {
    ({ default: mountPostUsersMagicLink } = await import("./post"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    signInMagicLinkMock.mockResolvedValue({ status: true });
    userFindUniqueMock.mockResolvedValue(null);
  });

  it("sends a magic link for an unregistered email", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-header": "forward-me",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
        name: "New User",
      }),
    });

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { email: "new.user@example.com" },
      select: { id: true },
    });

    const [call] = signInMagicLinkMock.mock.calls as Array<
      [
        {
          body: {
            callbackURL: string;
            email: string;
            name?: string;
            newUserCallbackURL: string;
          };
          headers: Headers;
        },
      ]
    >;

    expect(call?.[0].body).toEqual({
      email: "new.user@example.com",
      name: "New User",
      callbackURL: "https://app.example.com/",
      newUserCallbackURL: "https://app.example.com/",
    });
    expect(call?.[0].headers.get("x-test-header")).toBe("forward-me");

    const json = await response.json();
    expect(json.data).toEqual({ status: true });
  });

  it("omits name when the caller does not provide one", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
      }),
    });

    expect(response.status).toBe(200);
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      body: {
        email: "new.user@example.com",
        callbackURL: "https://app.example.com/",
        newUserCallbackURL: "https://app.example.com/",
      },
      headers: expect.any(Headers),
    });
  });

  it("builds a fresh OAuth authorize URL when oauth params are provided", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
        name: "New User",
        oauth: {
          response_type: "code",
          client_id: "client_123",
          redirect_uri: "https://consumer.example.com/callback",
          scope: "openid offline_access",
          state: "opaque-state",
          code_challenge: "pkce-challenge",
          code_challenge_method: "S256",
          nonce: "nonce_123",
          prompt: "consent",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      body: {
        email: "new.user@example.com",
        name: "New User",
        callbackURL:
          "https://auth.example.com/auth/oauth2/authorize?response_type=code&client_id=client_123&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&scope=openid+offline_access&state=opaque-state&code_challenge=pkce-challenge&code_challenge_method=S256&nonce=nonce_123&prompt=consent",
        newUserCallbackURL:
          "https://auth.example.com/auth/oauth2/authorize?response_type=code&client_id=client_123&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&scope=openid+offline_access&state=opaque-state&code_challenge=pkce-challenge&code_challenge_method=S256&nonce=nonce_123&prompt=consent",
      },
      headers: expect.any(Headers),
    });
  });

  it("serializes only defined oauth params into the authorize URL", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
        oauth: {
          response_type: "code",
          client_id: "client_123",
          code_challenge: "pkce-challenge",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      body: {
        email: "new.user@example.com",
        callbackURL:
          "https://auth.example.com/auth/oauth2/authorize?response_type=code&client_id=client_123&code_challenge=pkce-challenge",
        newUserCallbackURL:
          "https://auth.example.com/auth/oauth2/authorize?response_type=code&client_id=client_123&code_challenge=pkce-challenge",
      },
      headers: expect.any(Headers),
    });
  });

  it("rejects invalid oauth response types", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
        oauth: {
          response_type: "token",
          client_id: "client_123",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(signInMagicLinkMock).not.toHaveBeenCalled();
  });

  it("rejects invalid oauth code challenge methods", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
        oauth: {
          response_type: "code",
          client_id: "client_123",
          code_challenge_method: "plain",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(signInMagicLinkMock).not.toHaveBeenCalled();
  });

  it("passes oauth prompts through without local semantic validation", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
        oauth: {
          response_type: "code",
          client_id: "client_123",
          prompt: "approve-now",
        },
      }),
    });

    expect(response.status).toBe(200);
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      body: {
        email: "new.user@example.com",
        callbackURL:
          "https://auth.example.com/auth/oauth2/authorize?response_type=code&client_id=client_123&prompt=approve-now",
        newUserCallbackURL:
          "https://auth.example.com/auth/oauth2/authorize?response_type=code&client_id=client_123&prompt=approve-now",
      },
      headers: expect.any(Headers),
    });
  });

  it("rejects malformed oauth redirect URIs", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
        oauth: {
          response_type: "code",
          client_id: "client_123",
          redirect_uri: "not-a-url",
        },
      }),
    });

    expect(response.status).toBe(400);
    expect(signInMagicLinkMock).not.toHaveBeenCalled();
  });

  it("normalizes emails before user lookup and magic-link send", async () => {
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "New.User@Example.COM",
      }),
    });

    expect(response.status).toBe(200);
    expect(userFindUniqueMock).toHaveBeenCalledWith({
      where: { email: "new.user@example.com" },
      select: { id: true },
    });
    expect(signInMagicLinkMock).toHaveBeenCalledWith({
      body: {
        email: "new.user@example.com",
        callbackURL: "https://app.example.com/",
        newUserCallbackURL: "https://app.example.com/",
      },
      headers: expect.any(Headers),
    });
  });

  it("returns 409 when the email is already registered", async () => {
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
    const app = createApp();

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "existing.user@example.com",
      }),
    });

    expect(response.status).toBe(409);
    expect(signInMagicLinkMock).not.toHaveBeenCalled();
  });

  it("returns 403 for user-authenticated callers", async () => {
    const app = createApp({
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    });

    const response = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "new.user@example.com",
      }),
    });

    expect(response.status).toBe(403);
    expect(userFindUniqueMock).not.toHaveBeenCalled();
    expect(signInMagicLinkMock).not.toHaveBeenCalled();
  });
});
