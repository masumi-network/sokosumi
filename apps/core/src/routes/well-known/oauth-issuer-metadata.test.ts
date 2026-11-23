import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

// Core's real `auth` seeds the MCP resource row at startup.
vi.mock("@/lib/db/prisma", () => import("@/test/seeded-oauth-resource-prisma"));

/**
 * Integration smoke against real Better Auth metadata (no mocked oauthProvider* helpers).
 */
describe("well-known oauth issuer metadata integration", () => {
  it("returns issuer and /auth/oauth2 endpoints at the RFC 8414 path", async () => {
    const { default: wellKnownRouter } = await import("./index.js");
    const { default: authRouter } = await import("../auth/index.js");

    const app = new Hono();
    app.route("/", wellKnownRouter);
    app.route("/auth", authRouter);

    const response = await app.request(
      "http://localhost:8787/.well-known/oauth-authorization-server/auth",
    );

    expect(response.status).toBe(200);

    const metadata = (await response.json()) as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
    };

    expect(metadata.issuer).toMatch(/\/auth$/);
    expect(metadata.authorization_endpoint).toBe(
      `${metadata.issuer}/oauth2/authorize`,
    );
    expect(metadata.token_endpoint).toBe(`${metadata.issuer}/oauth2/token`);
    // Bumped from vitest's 5s default: this boots the whole Better Auth
    // handler, and that cold start exceeds 5s under full-suite parallel load
    // even though the test takes ~1.5s in isolation. Observed failing at
    // exactly 5007ms while this branch's added tests were in the run.
  }, 10_000);

  it("describes the MCP server as a resource of that issuer (RFC 9728)", async () => {
    const { default: wellKnownRouter } = await import("./index.js");
    const app = new Hono();
    app.route("/", wellKnownRouter);

    const authServer = (await (
      await app.request(
        "http://localhost:8787/.well-known/oauth-authorization-server/auth",
      )
    ).json()) as { issuer: string; scopes_supported: string[] };
    expect(authServer.scopes_supported).toContain("sokosumi:mcp");

    // The path MCP's 401 points at, and the root MCP clients fall back to.
    for (const path of [
      "/oauth-protected-resource/mcp",
      "/oauth-protected-resource",
    ]) {
      const response = await app.request(
        `http://localhost:8787/.well-known${path}`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resource: new URL("/mcp", authServer.issuer).href,
        resource_name: "Sokosumi MCP",
        authorization_servers: [authServer.issuer],
        scopes_supported: ["sokosumi:mcp", "offline_access"],
        bearer_methods_supported: ["header"],
      });
    }
  }, 10_000);
});
