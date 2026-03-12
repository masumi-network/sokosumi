import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  adminPluginMock,
  apiKeyPluginMock,
  betterAuthMock,
  i18nPluginMock,
  jwtPluginMock,
  oauthProviderPluginMock,
  openAPIPluginMock,
  organizationPluginMock,
  magicLinkPluginMock,
  postmarkSendEmailMock,
  prismaAdapterMock,
  renderMagicLinkTemplateMock,
} = vi.hoisted(() => ({
  adminPluginMock: vi.fn(),
  apiKeyPluginMock: vi.fn(),
  betterAuthMock: vi.fn(),
  i18nPluginMock: vi.fn(),
  jwtPluginMock: vi.fn(),
  oauthProviderPluginMock: vi.fn(),
  openAPIPluginMock: vi.fn(),
  organizationPluginMock: vi.fn(),
  magicLinkPluginMock: vi.fn(),
  postmarkSendEmailMock: vi.fn(),
  prismaAdapterMock: vi.fn(),
  renderMagicLinkTemplateMock: vi.fn(),
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
  magicLink: (...args: unknown[]) => magicLinkPluginMock(...args),
  openAPI: (...args: unknown[]) => openAPIPluginMock(...args),
  organization: (...args: unknown[]) => organizationPluginMock(...args),
}));

vi.mock("@better-auth/api-key", () => ({
  apiKey: (...args: unknown[]) => apiKeyPluginMock(...args),
}));

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: (...args: unknown[]) => oauthProviderPluginMock(...args),
}));

vi.mock("@better-auth/i18n", () => ({
  i18n: (...args: unknown[]) => i18nPluginMock(...args),
}));

vi.mock("@/clients/postmark.client", () => ({
  postmarkClient: {
    sendEmail: (...args: unknown[]) => postmarkSendEmailMock(...args),
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BETTER_AUTH_SECRET: "test-secret",
    POSTMARK_FROM_EMAIL: "no-reply@example.com",
    POSTMARK_SERVER_ID: "postmark-server-id",
    BETTER_AUTH_TRUSTED_ORIGIN: "https://example.com",
    BETTER_AUTH_URL: "https://example.com/auth",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { __prisma: true },
}));

vi.mock("@/lib/email", () => ({
  renderMagicLinkTemplate: (...args: unknown[]) =>
    renderMagicLinkTemplateMock(...args),
}));

describe("core auth config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    adminPluginMock.mockReturnValue("admin-plugin");
    apiKeyPluginMock.mockReturnValue("api-key-plugin");
    i18nPluginMock.mockReturnValue("i18n-plugin");
    jwtPluginMock.mockReturnValue("jwt-plugin");
    magicLinkPluginMock.mockReturnValue("magic-link-plugin");
    oauthProviderPluginMock.mockReturnValue("oauth-provider-plugin");
    openAPIPluginMock.mockReturnValue("openapi-plugin");
    organizationPluginMock.mockReturnValue("organization-plugin");
    postmarkSendEmailMock.mockResolvedValue({ MessageID: "message_123" });
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    renderMagicLinkTemplateMock.mockReturnValue("<html>magic link</html>");
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

  it("configures the magic link plugin", async () => {
    await import("./auth");

    expect(magicLinkPluginMock).toHaveBeenCalledTimes(1);

    const [[config]] = magicLinkPluginMock.mock.calls as Array<
      [{ sendMagicLink: unknown }]
    >;

    expect(config.sendMagicLink).toEqual(expect.any(Function));
  });

  it("sends magic-link emails with the core auth template", async () => {
    await import("./auth");

    const [[config]] = magicLinkPluginMock.mock.calls as Array<
      [
        {
          sendMagicLink: (
            data: {
              email: string;
              token: string;
              url: string;
            },
            ctx?: { body?: { name?: string } },
          ) => Promise<void>;
        },
      ]
    >;

    await config.sendMagicLink(
      {
        email: "andreas@example.com",
        url: "https://example.com/auth/magic-link/verify?token=secret",
        token: "secret-token",
      },
      {
        body: {
          name: "Andreas",
        },
      },
    );

    expect(renderMagicLinkTemplateMock).toHaveBeenCalledWith({
      magicLink: "https://example.com/auth/magic-link/verify?token=secret",
      token: "secret-token",
      name: "Andreas",
    });
    expect(postmarkSendEmailMock).toHaveBeenCalledWith({
      From: "no-reply@example.com",
      To: "andreas@example.com",
      Tag: "magic-link",
      Subject: "Sokosumi - Magic Link",
      HtmlBody: "<html>magic link</html>",
      MessageStream: "authentications",
    });
  });
});
