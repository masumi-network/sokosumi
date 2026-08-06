import { Hono } from "hono";
import { describe, expect, it } from "vitest";

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
    // Bumped from the 5s default: this boots the whole Better Auth handler, and
    // under full-suite parallel load that cold start exceeds 5s even though the
    // test takes ~1.5s in isolation.
  }, 10_000);
});
