import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  oauthAuthServerMetadataMock,
  oauthOpenIdConfigMetadataMock,
  authHandlerMock,
} = vi.hoisted(() => ({
  oauthAuthServerMetadataMock: vi.fn(),
  oauthOpenIdConfigMetadataMock: vi.fn(),
  authHandlerMock: vi.fn(),
}));

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProviderAuthServerMetadata: oauthAuthServerMetadataMock,
  oauthProviderOpenIdConfigMetadata: oauthOpenIdConfigMetadataMock,
}));

vi.mock("@/config/cors-allow-origin", () => ({
  resolveCorsAllowOrigin: () => "https://app.sokosumi.com",
}));

vi.mock("@/lib/auth.js", () => ({
  auth: {
    handler: authHandlerMock,
    api: { getOAuthServerConfig: vi.fn(), getOpenIdConfig: vi.fn() },
  },
}));

vi.mock("@/routes/auth/set-password.route.js", () => ({
  handleSetPassword: vi.fn(),
}));

describe("auth router oauth issuer metadata", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    authHandlerMock.mockImplementation(async () =>
      Response.json({ authenticated: true }),
    );

    oauthAuthServerMetadataMock.mockReturnValue(async () =>
      Response.json({
        issuer: "https://core.sokosumi.com/auth",
      }),
    );
    oauthOpenIdConfigMetadataMock.mockReturnValue(async () =>
      Response.json({
        issuer: "https://core.sokosumi.com/auth",
      }),
    );
  });

  it("serves oauth authorization server metadata before the auth catch-all", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request(
      "http://localhost/.well-known/oauth-authorization-server",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      issuer: "https://core.sokosumi.com/auth",
    });
    expect(oauthAuthServerMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("serves openid configuration before the auth catch-all", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request(
      "http://localhost/.well-known/openid-configuration",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      issuer: "https://core.sokosumi.com/auth",
    });
    expect(oauthOpenIdConfigMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("TestV33 redirects browser navigation and preserves auth headers", async () => {
    const redirectUrl =
      "https://app.sokosumi.com/oauth/consent?client_id=cli-client";
    const authResponseHeaders = new Headers();
    authResponseHeaders.append("set-cookie", "session=one; Path=/");
    authResponseHeaders.append("set-cookie", "session=two; Path=/");
    authResponseHeaders.set("x-auth-response", "retained");
    authHandlerMock.mockResolvedValueOnce(
      Response.json(
        { redirect: true, url: redirectUrl },
        { headers: authResponseHeaders },
      ),
    );
    const { default: app } = await import("./index.js");

    const response = await app.request(
      "http://localhost/oauth2/authorize?client_id=cli-client",
      {
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml",
          "sec-fetch-mode": "navigate",
        },
      },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(redirectUrl);
    expect(response.headers.get("x-auth-response")).toBe("retained");
    expect(
      (
        response.headers as Headers & { getSetCookie(): string[] }
      ).getSetCookie(),
    ).toEqual(["session=one; Path=/", "session=two; Path=/"]);
  });

  it("TestV33 preserves JSON responses for OAuth API clients", async () => {
    const payload = { redirect: true, url: "https://example.test/redirect" };
    authHandlerMock.mockResolvedValueOnce(Response.json(payload));
    const { default: app } = await import("./index.js");

    const response = await app.request(
      "http://localhost/oauth2/authorize?client_id=cli-client",
      {
        headers: {
          accept: "application/json",
          "sec-fetch-mode": "cors",
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(payload);
  });
});
