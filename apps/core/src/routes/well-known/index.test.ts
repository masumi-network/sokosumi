import { beforeEach, describe, expect, it, vi } from "vitest";

const { oauthAuthServerMetadataMock } = vi.hoisted(() => ({
  oauthAuthServerMetadataMock: vi.fn(),
}));

vi.mock("@/lib/auth-issuer-metadata.js", () => ({
  handleOAuthAuthServerMetadata: oauthAuthServerMetadataMock,
}));

vi.mock("@/lib/auth.js", () => ({ auth: {} }));

describe("well-known oauth issuer routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    oauthAuthServerMetadataMock.mockImplementation(async () =>
      Response.json({
        issuer: "https://core.sokosumi.com/auth",
        authorization_endpoint:
          "https://core.sokosumi.com/auth/oauth2/authorize",
      }),
    );
  });

  it("serves oauth authorization server metadata at the RFC 8414 path", async () => {
    const { default: app } = await import("./index.js");

    const response = await app.request(
      "http://localhost/.well-known/oauth-authorization-server/auth",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      issuer: "https://core.sokosumi.com/auth",
    });
    expect(oauthAuthServerMetadataMock).toHaveBeenCalledTimes(1);
  });
});
