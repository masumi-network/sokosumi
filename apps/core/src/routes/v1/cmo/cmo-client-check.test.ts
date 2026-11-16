import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { AuthEnv, AuthenticationContext } from "@/middleware/auth";

const env = vi.hoisted(() => ({
  CMO_OAUTH_CLIENT_ID: "cmo-oauth-client" as string | undefined,
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), ...env }),
  };
});

const { cmoClientCheck } = await import("./cmo-client-check");

const person = {
  actor: "user",
  userId: "user-1",
  organizationId: null,
  role: "user",
} as const;

function appFor(authContext: AuthenticationContext) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    c.set("authContext", authContext);
    await next();
  });
  app.use("*", cmoClientCheck);
  app.get("/projects/p/overview", (c) => c.text("read"));
  app.post("/projects/p/brand-brain/confirm", (c) => c.text("written"));
  app.onError(errorHandler);
  return app;
}

async function write(authContext: AuthenticationContext) {
  return appFor(authContext).request("/projects/p/brand-brain/confirm", {
    method: "POST",
  });
}

describe("cmoClientCheck", () => {
  beforeEach(() => {
    env.CMO_OAUTH_CLIENT_ID = "cmo-oauth-client";
  });

  it("lets CMO's client write", async () => {
    const response = await write({
      ...person,
      authenticationMethod: "oauth",
      oauthClientId: "cmo-oauth-client",
    });
    expect(response.status).toBe(200);
  });

  it.each([
    ["an API key", { ...person, authenticationMethod: "api_key" as const }],
    ["a session", { ...person, authenticationMethod: "session" as const }],
    [
      "another OAuth client",
      {
        ...person,
        authenticationMethod: "oauth" as const,
        oauthClientId: "someone-elses-client",
      },
    ],
    [
      "a coworker",
      { actor: "coworker" as const, coworkerId: "cw-1", vendorId: "v-1" },
    ],
  ])("refuses a write from %s with cmo_client_required", async (_, auth) => {
    const response = await write(auth);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      kind: "cmo_client_required",
    });
  });

  it("refuses every write while CMO_OAUTH_CLIENT_ID is unset", async () => {
    env.CMO_OAUTH_CLIENT_ID = undefined;
    const response = await write({
      ...person,
      authenticationMethod: "oauth",
      oauthClientId: "cmo-oauth-client",
    });
    expect(response.status).toBe(403);
  });

  it("keeps reads open to any member", async () => {
    const response = await appFor({
      ...person,
      authenticationMethod: "session",
    }).request("/projects/p/overview");
    expect(response.status).toBe(200);
  });
});
