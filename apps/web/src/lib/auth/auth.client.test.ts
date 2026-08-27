import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

const createAuthClientMock = vi.fn();
const adminClientMock = vi.fn(() => "admin-plugin");
const apiKeyClientMock = vi.fn(() => "api-key-plugin");
const inferAdditionalFieldsMock = vi.fn(() => "infer-additional-fields-plugin");
const inferOrgAdditionalFieldsMock = vi.fn(
  () => "infer-org-additional-fields-plugin",
);
const jwtClientMock = vi.fn(() => "jwt-plugin");
const lastLoginMethodClientMock = vi.fn(() => "last-login-method-plugin");
const magicLinkClientMock = vi.fn(() => "magic-link-plugin");
const organizationClientMock = vi.fn(() => "organization-plugin");
const oauthProviderClientMock = vi.fn(() => "oauth-plugin");
const passkeyClientMock = vi.fn(() => "passkey-plugin");
const stripeClientMock = vi.fn(() => "stripe-plugin");
const getEnvPublicConfigMock = vi.fn();

vi.mock("better-auth/react", () => ({
  createAuthClient: createAuthClientMock,
}));

vi.mock("better-auth/client/plugins", () => ({
  adminClient: adminClientMock,
  inferAdditionalFields: inferAdditionalFieldsMock,
  inferOrgAdditionalFields: inferOrgAdditionalFieldsMock,
  jwtClient: jwtClientMock,
  lastLoginMethodClient: lastLoginMethodClientMock,
  magicLinkClient: magicLinkClientMock,
  organizationClient: organizationClientMock,
}));

vi.mock("@better-auth/api-key/client", () => ({
  apiKeyClient: apiKeyClientMock,
}));

vi.mock("@better-auth/oauth-provider/client", () => ({
  oauthProviderClient: oauthProviderClientMock,
}));

vi.mock("@better-auth/passkey/client", () => ({
  passkeyClient: passkeyClientMock,
}));

vi.mock("@better-auth/stripe/client", () => ({
  stripeClient: stripeClientMock,
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

describe("auth client", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    createAuthClientMock.mockReturnValue({});
    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_NETWORK: "Preprod",
      NEXT_PUBLIC_VERCEL_ENV: undefined,
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: undefined,
      NEXT_PUBLIC_CORE_APP_BASE_URL: "http://localhost:8787/v1",
    });
  });

  it("points authClient at Core /auth", async () => {
    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_NETWORK: "Preprod",
      NEXT_PUBLIC_VERCEL_ENV: undefined,
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: undefined,
      NEXT_PUBLIC_CORE_APP_BASE_URL: "https://api.preprod.sokosumi.com/v1",
    });

    await import("./auth.client");

    const [[config]] = createAuthClientMock.mock.calls as Array<
      [
        {
          baseURL?: string;
          fetchOptions?: { credentials: string };
        },
      ]
    >;

    expect(config.baseURL).toBe("https://api.preprod.sokosumi.com/auth");
    expect(config.fetchOptions).toEqual({ credentials: "include" });
  });

  it("registers adminClient in createAuthClient plugins", async () => {
    await import("./auth.client");

    expect(createAuthClientMock).toHaveBeenCalledTimes(1);
    expect(adminClientMock).toHaveBeenCalledWith();

    const [[{ plugins }]] = createAuthClientMock.mock.calls as Array<
      [{ plugins: unknown[] }]
    >;

    expect(plugins).toEqual(expect.arrayContaining(["admin-plugin"]));
  });

  it("registers passkeyClient in createAuthClient plugins", async () => {
    await import("./auth.client");

    expect(passkeyClientMock).toHaveBeenCalledWith();

    const [[{ plugins }]] = createAuthClientMock.mock.calls as Array<
      [{ plugins: unknown[] }]
    >;

    expect(plugins).toEqual(expect.arrayContaining(["passkey-plugin"]));
  });

  it("configures lastLoginMethodClient with the computed cookie name", async () => {
    await import("./auth.client");

    expect(lastLoginMethodClientMock).toHaveBeenCalledWith({
      cookieName: "sokosumi-localhost-preprod.last_used_login_method",
    });
  });

  it("uses the preview branch prefix when the public Vercel env is preview", async () => {
    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_NETWORK: "Mainnet",
      NEXT_PUBLIC_VERCEL_ENV: "preview",
      NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: "feature/123",
    });

    await import("./auth.client");

    expect(lastLoginMethodClientMock).toHaveBeenCalledWith({
      cookieName: "sokosumi-preview-mainnet-feature-123.last_used_login_method",
    });
  });
});
