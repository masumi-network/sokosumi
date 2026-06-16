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
