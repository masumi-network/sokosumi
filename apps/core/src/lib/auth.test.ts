import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  adminPluginMock,
  apiKeyPluginMock,
  betterAuthMock,
  jwtPluginMock,
  localizationPluginMock,
  oauthProviderPluginMock,
  openAPIPluginMock,
  organizationPluginMock,
  prismaAdapterMock,
} = vi.hoisted(() => ({
  adminPluginMock: vi.fn(),
  apiKeyPluginMock: vi.fn(),
  betterAuthMock: vi.fn(),
  jwtPluginMock: vi.fn(),
  localizationPluginMock: vi.fn(),
  oauthProviderPluginMock: vi.fn(),
  openAPIPluginMock: vi.fn(),
  organizationPluginMock: vi.fn(),
  prismaAdapterMock: vi.fn(),
}));

vi.mock("better-auth/minimal", () => ({
  betterAuth: (...args: unknown[]) => betterAuthMock(...args),
}));

vi.mock("@better-auth/prisma-adapter", () => ({
  prismaAdapter: (...args: unknown[]) => prismaAdapterMock(...args),
}));

vi.mock("better-auth/plugins", () => ({
  admin: (...args: unknown[]) => adminPluginMock(...args),
  jwt: (...args: unknown[]) => jwtPluginMock(...args),
  openAPI: (...args: unknown[]) => openAPIPluginMock(...args),
  organization: (...args: unknown[]) => organizationPluginMock(...args),
}));

vi.mock("@better-auth/api-key", () => ({
  apiKey: (...args: unknown[]) => apiKeyPluginMock(...args),
}));

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: (...args: unknown[]) => oauthProviderPluginMock(...args),
}));

vi.mock("better-auth-localization", () => ({
  localization: (...args: unknown[]) => localizationPluginMock(...args),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_TRUSTED_ORIGIN: "https://example.com",
    BETTER_AUTH_URL: "https://example.com/auth",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { __prisma: true },
}));

describe("core auth config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    adminPluginMock.mockReturnValue("admin-plugin");
    apiKeyPluginMock.mockReturnValue("api-key-plugin");
    jwtPluginMock.mockReturnValue("jwt-plugin");
    localizationPluginMock.mockReturnValue("localization-plugin");
    oauthProviderPluginMock.mockReturnValue("oauth-provider-plugin");
    openAPIPluginMock.mockReturnValue("openapi-plugin");
    organizationPluginMock.mockReturnValue("organization-plugin");
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    betterAuthMock.mockReturnValue({ api: {}, handler: vi.fn() });
  });

  it("registers the Better Auth admin plugin", async () => {
    await import("./auth");

    expect(betterAuthMock).toHaveBeenCalledTimes(1);
    expect(adminPluginMock).toHaveBeenCalledWith();

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ plugins: unknown[] }]
    >;

    expect(config.plugins).toEqual(expect.arrayContaining(["admin-plugin"]));
  });
});
