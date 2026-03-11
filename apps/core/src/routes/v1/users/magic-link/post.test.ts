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
    BETTER_AUTH_TRUSTED_ORIGIN: "https://app.example.com",
  }),
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
