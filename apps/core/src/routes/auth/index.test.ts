import { beforeEach, describe, expect, it, vi } from "vitest";

const { oauthAuthServerMetadataMock, oauthOpenIdConfigMetadataMock } =
  vi.hoisted(() => ({
    oauthAuthServerMetadataMock: vi.fn(),
    oauthOpenIdConfigMetadataMock: vi.fn(),
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
    handler: vi.fn(),
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

  it("allows the captcha header in browser preflight requests", async () => {
    const { default: app } = await import("./index.js");
    const response = await app.request(
      "https://core.sokosumi.com/sign-up/email",
      {
        method: "OPTIONS",
        headers: {
          origin: "https://app.sokosumi.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,x-captcha-response",
        },
      },
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "x-captcha-response",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
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
});
