import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import app, { mountComposioCallback } from "./index";

const completeComposioCallbackMock = vi.hoisted(() => vi.fn());

const SESSION_AUTH: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const USER_API_KEY_AUTH: AuthenticationContext = {
  ...SESSION_AUTH,
  authenticationMethod: "api_key",
};

const OAUTH_TOKEN_AUTH: AuthenticationContext = {
  ...SESSION_AUTH,
  authenticationMethod: "oauth",
};

vi.mock("@/services/composio-callback-completion.service", () => ({
  completeComposioCallback: completeComposioCallbackMock,
}));

function createApp(authContext: AuthenticationContext) {
  const route = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  route.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    await next();
  });
  mountComposioCallback(route);
  return route;
}

describe("POST /composio/callback/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a callback completion request with no JSON body", async () => {
    const route = new OpenAPIHono<EnvVariables>({
      defaultHook: defaultValidationHook,
    });
    mountComposioCallback(route);
    const response = await route.request("http://localhost/callback/complete", {
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect(completeComposioCallbackMock).not.toHaveBeenCalled();
  });

  it("documents its JSON request body as required", () => {
    const document = app.getOpenAPIDocument({
      openapi: "3.0.0",
      info: { title: "Test", version: "1" },
    });

    expect(
      document.paths?.["/callback/complete"]?.post?.requestBody,
    ).toMatchObject({ required: true });
  });

  it.each([
    ["user API key", USER_API_KEY_AUTH],
    ["OAuth token", OAUTH_TOKEN_AUTH],
  ] as const)("rejects a %s callback redemption", async (_name, auth) => {
    const response = await createApp(auth).request(
      "http://localhost/callback/complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: "ca_123",
          sessionUri: "https://backend.composio.dev/session/single-use",
        }),
      },
    );

    expect(response.status).toBe(403);
    expect(completeComposioCallbackMock).not.toHaveBeenCalled();
  });

  it("redeems a callback for an interactive session", async () => {
    const response = await createApp(SESSION_AUTH).request(
      "http://localhost/callback/complete",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: "ca_123",
          sessionUri: "https://backend.composio.dev/session/single-use",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(completeComposioCallbackMock).toHaveBeenCalledWith({
      connectionId: "ca_123",
      sessionUri: "https://backend.composio.dev/session/single-use",
      userId: "user_123",
    });
  });
});
