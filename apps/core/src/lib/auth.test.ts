import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  adminPluginMock,
  apiKeyPluginMock,
  betterAuthMock,
  getBetterAuthPublicBaseUrlMock,
  getEnvMock,
  getBetterAuthProductionUrlMock,
  getWebAppBaseUrlMock,
  i18nPluginMock,
  jwtPluginMock,
  oauthProviderPluginMock,
  oAuthProxyPluginMock,
  openAPIPluginMock,
  organizationPluginMock,
  magicLinkPluginMock,
  postmarkSendEmailMock,
  prismaAdapterMock,
  renderMagicLinkEmailMock,
  sentryCaptureExceptionMock,
  stripeCreateUserCustomerMock,
  workspaceUpsertMock,
} = vi.hoisted(() => ({
  adminPluginMock: vi.fn(),
  apiKeyPluginMock: vi.fn(),
  betterAuthMock: vi.fn(),
  getBetterAuthPublicBaseUrlMock: vi.fn(),
  getEnvMock: vi.fn(),
  getBetterAuthProductionUrlMock: vi.fn(),
  getWebAppBaseUrlMock: vi.fn(),
  i18nPluginMock: vi.fn(),
  jwtPluginMock: vi.fn(),
  oauthProviderPluginMock: vi.fn(),
  oAuthProxyPluginMock: vi.fn(),
  openAPIPluginMock: vi.fn(),
  organizationPluginMock: vi.fn(),
  magicLinkPluginMock: vi.fn(),
  postmarkSendEmailMock: vi.fn(),
  prismaAdapterMock: vi.fn(),
  renderMagicLinkEmailMock: vi.fn(),
  sentryCaptureExceptionMock: vi.fn(),
  stripeCreateUserCustomerMock: vi.fn(),
  workspaceUpsertMock: vi.fn(),
}));

function getDefaultEnv() {
  return {
    BETTER_AUTH_COOKIE_DOMAIN: undefined,
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: 60,
    NETWORK: "Preprod",
    NODE_ENV: "production",
    POSTMARK_FROM_EMAIL: "no-reply@example.com",
    POSTMARK_SERVER_ID: "postmark-server-id",
    STRIPE_SECRET_KEY: "sk_test_123",
    VERCEL_ENV: undefined,
    VERCEL_GIT_COMMIT_REF: "",
  };
}

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
  oAuthProxy: (...args: unknown[]) => oAuthProxyPluginMock(...args),
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

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  workspaceRepository: {
    upsertOrganizationWorkspace: (...args: unknown[]) =>
      workspaceUpsertMock(...args),
    upsertPersonalWorkspace: (...args: unknown[]) =>
      workspaceUpsertMock(...args),
  },
}));

vi.mock("@/clients/postmark.client", () => ({
  postmarkClient: {
    sendEmail: (...args: unknown[]) => postmarkSendEmailMock(...args),
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    createUserCustomer: (...args: unknown[]) =>
      stripeCreateUserCustomerMock(...args),
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => getEnvMock(),
  getBetterAuthPublicBaseUrl: () => getBetterAuthPublicBaseUrlMock(),
  getWebAppBaseUrl: () => getWebAppBaseUrlMock(),
}));

vi.mock("@/config/better-auth-production-url", () => ({
  getBetterAuthProductionUrl: () => getBetterAuthProductionUrlMock(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { __prisma: true },
}));

vi.mock("@sokosumi/email", () => ({
  renderMagicLinkEmail: (...args: unknown[]) =>
    renderMagicLinkEmailMock(...args),
}));

describe("core auth config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    adminPluginMock.mockReturnValue("admin-plugin");
    apiKeyPluginMock.mockReturnValue("api-key-plugin");
    i18nPluginMock.mockReturnValue("i18n-plugin");
    getEnvMock.mockReturnValue(getDefaultEnv());
    getBetterAuthPublicBaseUrlMock.mockReturnValue("https://example.com/auth");
    getWebAppBaseUrlMock.mockReturnValue("https://example.com");
    jwtPluginMock.mockReturnValue("jwt-plugin");
    magicLinkPluginMock.mockReturnValue("magic-link-plugin");
    oAuthProxyPluginMock.mockReturnValue("oauth-proxy-plugin");
    oauthProviderPluginMock.mockReturnValue("oauth-provider-plugin");
    openAPIPluginMock.mockReturnValue("openapi-plugin");
    organizationPluginMock.mockReturnValue("organization-plugin");
    postmarkSendEmailMock.mockResolvedValue({ MessageID: "message_123" });
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    renderMagicLinkEmailMock.mockResolvedValue({
      html: "<html>magic link</html>",
      subject: "Sokosumi - Sign in to your account",
    });
    sentryCaptureExceptionMock.mockReset();
    stripeCreateUserCustomerMock.mockResolvedValue({ id: "cus_123" });
    workspaceUpsertMock.mockResolvedValue({ id: "workspace_123" });
    betterAuthMock.mockReturnValue({ api: {}, handler: vi.fn() });
    getBetterAuthProductionUrlMock.mockReturnValue("https://example.com/auth");
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

  it("uses the canonical production URL for the OAuth proxy", async () => {
    getBetterAuthProductionUrlMock.mockReturnValue(
      "https://canonical.example.com",
    );

    await import("./auth");

    expect(oAuthProxyPluginMock).toHaveBeenCalledWith({
      productionURL: "https://canonical.example.com",
    });
  });

  it("enables Better Auth cookie cache for core sessions", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          session: {
            cookieCache?: {
              enabled: boolean;
              maxAge: number;
            };
            storeSessionInDatabase?: boolean;
          };
        },
      ]
    >;

    expect(config.session.cookieCache).toEqual({
      enabled: true,
      maxAge: 60,
    });
    expect(config.session.storeSessionInDatabase).toBe(true);
  });

  it("disables cross-subdomain cookies when no cookie domain is configured", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      BETTER_AUTH_COOKIE_DOMAIN: undefined,
    });

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          advanced: {
            cookiePrefix?: string;
            crossSubDomainCookies?: {
              domain: string;
              enabled: true;
            };
          };
        },
      ]
    >;

    expect(config.advanced.crossSubDomainCookies).toBeUndefined();
    expect(config.advanced.cookiePrefix).toBe("sokosumi-localhost-preprod");
  });

  it("uses the configured cookie domain when provided", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      BETTER_AUTH_COOKIE_DOMAIN: "preview.sokosumi.com",
      VERCEL_ENV: "production",
    });
    getBetterAuthPublicBaseUrlMock.mockReturnValue(
      "https://api.preprod.sokosumi.com/auth",
    );
    getWebAppBaseUrlMock.mockReturnValue("https://preprod.sokosumi.com");

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          advanced: {
            cookiePrefix?: string;
            crossSubDomainCookies?: {
              domain: string;
              enabled: true;
            };
          };
        },
      ]
    >;

    expect(config.advanced.crossSubDomainCookies).toEqual({
      enabled: true,
      domain: "preview.sokosumi.com",
    });
    expect(config.advanced.cookiePrefix).toBe("sokosumi-preprod");
  });

  it("uses the production cookie prefix on mainnet hosts", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      NETWORK: "Mainnet",
      VERCEL_ENV: "production",
    });
    getBetterAuthPublicBaseUrlMock.mockReturnValue(
      "https://api.sokosumi.com/auth",
    );
    getWebAppBaseUrlMock.mockReturnValue("https://app.sokosumi.com");

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          advanced: {
            cookiePrefix?: string;
          };
        },
      ]
    >;

    expect(config.advanced.cookiePrefix).toBe("sokosumi");
  });

  it("uses the configured cookie domain for previews when provided", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      BETTER_AUTH_COOKIE_DOMAIN: "sokosumi.com",
      NETWORK: "Mainnet",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/123",
    });
    getBetterAuthPublicBaseUrlMock.mockReturnValue(
      "https://sokosumi-core-preprod-git-feature-123.preview.sokosumi.com/auth",
    );
    getWebAppBaseUrlMock.mockReturnValue(
      "https://feature-123.preview.sokosumi.com",
    );

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          advanced: {
            cookiePrefix?: string;
            crossSubDomainCookies?: {
              domain: string;
              enabled: true;
            };
          };
        },
      ]
    >;

    expect(config.advanced.cookiePrefix).toBe(
      "sokosumi-preview-mainnet-feature-123",
    );
    expect(config.advanced.crossSubDomainCookies).toEqual({
      enabled: true,
      domain: "sokosumi.com",
    });
  });

  it("falls back to the network-specific preview prefix when preview commit ref is empty", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "",
    });
    getBetterAuthPublicBaseUrlMock.mockReturnValue(
      "https://deployment-abc.vercel.app/auth",
    );
    getWebAppBaseUrlMock.mockReturnValue("https://deployment-abc.vercel.app");

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          advanced: {
            cookiePrefix?: string;
          };
        },
      ]
    >;

    expect(config.advanced.cookiePrefix).toBe("sokosumi-preview-preprod");
  });

  it("uses English for magic-link emails", async () => {
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
            ctx?: {
              body?: { name?: string };
              headers?: Headers;
              request?: Request;
            },
          ) => Promise<void>;
        },
      ]
    >;

    const request = new Request("https://example.com/auth/sign-in/magic-link", {
      headers: {
        "accept-language": "de-DE,de;q=0.9",
        cookie: "sokosumi.locale=pt-BR",
      },
    });

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
        headers: new Headers({
          cookie: "sokosumi.locale=pt-BR",
        }),
        request,
      },
    );

    expect(renderMagicLinkEmailMock).toHaveBeenCalledWith({
      locale: "en",
      magicLink: "https://example.com/auth/magic-link/verify?token=secret",
      name: "Andreas",
    });
    expect(postmarkSendEmailMock).toHaveBeenCalledWith({
      From: "no-reply@example.com",
      To: "andreas@example.com",
      Tag: "magic-link",
      Subject: "Sokosumi - Sign in to your account",
      HtmlBody: "<html>magic link</html>",
      MessageStream: "authentications",
    });
  });

  it("stores the email prefix when a new user is created without a name", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                before: (user: {
                  email: string;
                  id: string;
                  name: string;
                }) => Promise<{
                  data: {
                    email: string;
                    id: string;
                    name: string;
                  };
                }>;
                after: (user: {
                  email: string;
                  id: string;
                  name: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    const normalizedCreate = await config.databaseHooks.user.create.before({
      email: " magic@example.com ",
      id: "user_123",
      name: "   ",
    });

    expect(normalizedCreate).toEqual({
      data: {
        email: " magic@example.com ",
        id: "user_123",
        name: "magic",
      },
    });

    await config.databaseHooks.user.create.after(normalizedCreate.data);

    expect(workspaceUpsertMock).toHaveBeenCalledWith({
      tx: { __prisma: true },
      userId: "user_123",
    });
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith({
      email: " magic@example.com ",
      name: "magic",
      userId: "user_123",
    });
  });

  it("falls back to the full email when the local part is empty", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                before: (user: {
                  email: string;
                  id: string;
                  name: string;
                }) => Promise<{
                  data: {
                    email: string;
                    id: string;
                    name: string;
                  };
                }>;
              };
            };
          };
        },
      ]
    >;

    const normalizedCreate = await config.databaseHooks.user.create.before({
      email: "@example.com",
      id: "user_123",
      name: "",
    });

    expect(normalizedCreate).toEqual({
      data: {
        email: "@example.com",
        id: "user_123",
        name: "@example.com",
      },
    });
  });

  it("creates a Stripe customer when a new user is created", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                after: (user: {
                  email: string;
                  id: string;
                  name: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await config.databaseHooks.user.create.after({
      email: "andreas@example.com",
      id: "user_123",
      name: "Andreas",
    });

    expect(workspaceUpsertMock).toHaveBeenCalledWith({
      tx: { __prisma: true },
      userId: "user_123",
    });
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith({
      email: "andreas@example.com",
      name: "Andreas",
      userId: "user_123",
    });
  });

  it("reports workspace creation failures to Sentry without blocking user creation", async () => {
    workspaceUpsertMock.mockRejectedValueOnce(new Error("workspace failed"));

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                after: (user: {
                  email: string;
                  id: string;
                  name: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await config.databaseHooks.user.create.after({
      email: "andreas@example.com",
      id: "user_123",
      name: "Andreas",
    });

    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        email: "andreas@example.com",
        name: "Andreas",
        userId: "user_123",
      },
      tags: {
        context: "workspace_user_creation",
      },
    });
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith({
      email: "andreas@example.com",
      name: "Andreas",
      userId: "user_123",
    });
  });

  it("reports Stripe customer creation failures to Sentry", async () => {
    stripeCreateUserCustomerMock.mockRejectedValueOnce(
      new Error("stripe failed"),
    );

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                after: (user: {
                  email: string;
                  id: string;
                  name: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await config.databaseHooks.user.create.after({
      email: "andreas@example.com",
      id: "user_123",
      name: "Andreas",
    });
    await Promise.resolve();

    expect(workspaceUpsertMock).toHaveBeenCalledWith({
      tx: { __prisma: true },
      userId: "user_123",
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        email: "andreas@example.com",
        name: "Andreas",
        userId: "user_123",
      },
      tags: {
        context: "stripe_user_customer_creation",
      },
    });
  });

  it("reports organization workspace creation failures to Sentry", async () => {
    workspaceUpsertMock.mockRejectedValueOnce(new Error("workspace failed"));

    await import("./auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterCreateOrganization: (input: {
              organization: {
                id: string;
                name: string;
              };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.afterCreateOrganization({
      organization: {
        id: "org_123",
        name: "Org One",
      },
    });

    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        organizationId: "org_123",
        organizationName: "Org One",
      },
      tags: {
        context: "workspace_organization_creation",
      },
    });
  });
});
