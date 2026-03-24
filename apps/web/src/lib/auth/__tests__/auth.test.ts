import { beforeEach, describe, expect, it, vi } from "vitest";

const adminPluginMock = vi.fn();
const apiKeyPluginMock = vi.fn();
const betterAuthMock = vi.fn();
const createAuthMiddlewareMock = vi.fn((callback) => callback);
const getBetterAuthProductionUrlMock = vi.fn();
const getEnvPublicConfigMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const getInfraAuthPluginsMock = vi.fn();
const i18nPluginMock = vi.fn();
const jwtPluginMock = vi.fn();
const lastLoginMethodPluginMock = vi.fn();
const magicLinkPluginMock = vi.fn();
const marketingOptInUserSchemaSafeParseMock = vi.fn();
const nextCookiesPluginMock = vi.fn();
const oAuthProxyPluginMock = vi.fn();
const oauthProviderPluginMock = vi.fn();
const organizationPluginMock = vi.fn();
const renderOrganizationInvitationEmailMock = vi.fn();
const renderResetPasswordEmailMock = vi.fn();
const renderVerificationEmailMock = vi.fn();
const callUserCreatedWebHookMock = vi.fn();
const callUserUpdatedWebHookMock = vi.fn();
const postmarkSendEmailMock = vi.fn();
const prismaAdapterMock = vi.fn();
const renderMagicLinkEmailMock = vi.fn();
const stripeCreateUserCustomerMock = vi.fn();
const stripePluginMock = vi.fn();
const stripeSdkMock = vi.fn(function MockStripe() {
  return { __stripe: true };
});

function getDefaultEnvSecrets() {
  return {
    BETTER_AUTH_API_KEY: "test-api-key",
    BETTER_AUTH_COOKIE_DOMAIN: undefined,
    BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN: 900,
    BETTER_AUTH_ORG_INVITATION_EXPIRES_IN: 86_400,
    BETTER_AUTH_ORG_INVITATION_LIMIT: 10,
    BETTER_AUTH_ORG_LIMIT: 5,
    BETTER_AUTH_PROFILE_PICTURE_TIMEOUT: 5_000,
    BETTER_AUTH_RP_ID: "example.com",
    BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: 60,
    BETTER_AUTH_URL: "https://example.com/auth",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    MICROSOFT_CLIENT_ID: "microsoft-client-id",
    MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
    NETWORK: "Preprod",
    POSTMARK_FROM_EMAIL: "no-reply@example.com",
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: "whsec_123",
    VERCEL_GIT_COMMIT_REF: "",
    VERCEL_BRANCH_URL: "",
    VERCEL_URL: "",
    WEB_APP_BASE_URL: "https://example.com",
  };
}

vi.mock("server-only", () => ({}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@better-auth/api-key", () => ({
  apiKey: (...args: unknown[]) => apiKeyPluginMock(...args),
}));

vi.mock("@better-auth/i18n", () => ({
  i18n: (...args: unknown[]) => i18nPluginMock(...args),
}));

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: (...args: unknown[]) => oauthProviderPluginMock(...args),
}));

const passkeyPluginMock = vi.fn();

vi.mock("@better-auth/passkey", () => ({
  passkey: (...args: unknown[]) => passkeyPluginMock(...args),
}));

vi.mock("@better-auth/prisma-adapter", () => ({
  prismaAdapter: (...args: unknown[]) => prismaAdapterMock(...args),
}));

vi.mock("@better-auth/stripe", () => ({
  stripe: (...args: unknown[]) => stripePluginMock(...args),
}));

vi.mock("better-auth/api", () => {
  class MockApiError extends Error {}

  return {
    APIError: MockApiError,
    createAuthMiddleware: createAuthMiddlewareMock,
  };
});

vi.mock("better-auth/minimal", () => ({
  betterAuth: (...args: unknown[]) => betterAuthMock(...args),
}));

vi.mock("better-auth/next-js", () => ({
  nextCookies: (...args: unknown[]) => nextCookiesPluginMock(...args),
}));

vi.mock("better-auth/plugins", () => ({
  admin: (...args: unknown[]) => adminPluginMock(...args),
  jwt: (...args: unknown[]) => jwtPluginMock(...args),
  lastLoginMethod: (...args: unknown[]) => lastLoginMethodPluginMock(...args),
  magicLink: (...args: unknown[]) => magicLinkPluginMock(...args),
  oAuthProxy: (...args: unknown[]) => oAuthProxyPluginMock(...args),
  organization: (...args: unknown[]) => organizationPluginMock(...args),
}));

vi.mock("stripe", () => ({
  __esModule: true,
  default: stripeSdkMock,
}));

vi.mock("@sokosumi/database", () => ({
  MemberRole: {
    ADMIN: "ADMIN",
    OWNER: "OWNER",
  },
  User: {},
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: vi.fn(),
  },
}));

vi.mock("@sokosumi/email", () => ({
  renderMagicLinkEmail: (...args: unknown[]) =>
    renderMagicLinkEmailMock(...args),
  renderOrganizationInvitationEmail: (...args: unknown[]) =>
    renderOrganizationInvitationEmailMock(...args),
  renderResetPasswordEmail: (...args: unknown[]) =>
    renderResetPasswordEmailMock(...args),
  renderVerificationEmail: (...args: unknown[]) =>
    renderVerificationEmailMock(...args),
}));

vi.mock("@sokosumi/masumi/auth", () => ({
  authTranslations: {},
}));

vi.mock("p-timeout", () => ({
  __esModule: true,
  default: (promise: Promise<unknown>) => promise,
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

vi.mock("@/config/better-auth-production-url", () => ({
  getBetterAuthProductionUrl: () => getBetterAuthProductionUrlMock(),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

vi.mock("@/lib/auth/infra-plugins", () => ({
  getInfraAuthPlugins: (...args: unknown[]) => getInfraAuthPluginsMock(...args),
}));

vi.mock("@/lib/blob/utils", () => ({
  uploadProfileImage: vi.fn(),
}));

vi.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: vi.fn(() => Promise.resolve()),
    createUserCustomer: (...args: unknown[]) =>
      stripeCreateUserCustomerMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: { __prisma: true },
}));

vi.mock("@/lib/email/postmark", () => ({
  postmarkClient: {
    sendEmail: postmarkSendEmailMock,
  },
}));

vi.mock("@/lib/schemas", () => ({
  marketingOptInUserSchema: {
    safeParse: marketingOptInUserSchemaSafeParseMock,
  },
}));

vi.mock("@/lib/services", () => ({
  callAccountCreatedWebHook: vi.fn(),
  callUserCreatedWebHook: callUserCreatedWebHookMock,
  callUserUpdatedWebHook: callUserUpdatedWebHookMock,
  organizationSubscriptionService: {
    ensureCanAcceptInvitation: vi.fn(),
    ensureCanCreateInvitation: vi.fn(),
  },
  preferredOrganizationService: {
    resolveActiveOrganizationIdForSession: vi.fn(),
  },
  stripeService: {},
}));

vi.mock("@/lib/stripe/subscription-catalog", () => ({
  getBetterAuthSubscriptionPlans: vi.fn(),
}));

vi.mock("@/lib/stripe/webhook-handlers", () => ({
  handleCustomerCreatedEvent: vi.fn(),
  handleCustomerUpdatedEvent: vi.fn(),
  handleInvoicePaidEvent: vi.fn(),
}));

describe("web auth config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    adminPluginMock.mockReturnValue("admin-plugin");
    apiKeyPluginMock.mockReturnValue("api-key-plugin");
    betterAuthMock.mockReturnValue({ api: {}, handler: vi.fn() });
    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_PASSWORD_MAX_LENGTH: 128,
      NEXT_PUBLIC_PASSWORD_MIN_LENGTH: 12,
    });
    getEnvSecretsMock.mockReturnValue(getDefaultEnvSecrets());
    getBetterAuthProductionUrlMock.mockReturnValue("https://example.com/auth");
    getInfraAuthPluginsMock.mockReturnValue([]);
    i18nPluginMock.mockReturnValue("i18n-plugin");
    jwtPluginMock.mockReturnValue("jwt-plugin");
    lastLoginMethodPluginMock.mockReturnValue("last-login-method-plugin");
    magicLinkPluginMock.mockReturnValue("magic-link-plugin");
    nextCookiesPluginMock.mockReturnValue("next-cookies-plugin");
    oAuthProxyPluginMock.mockReturnValue("oauth-proxy-plugin");
    oauthProviderPluginMock.mockReturnValue("oauth-provider-plugin");
    organizationPluginMock.mockReturnValue("organization-plugin");
    passkeyPluginMock.mockReturnValue("passkey-plugin");
    marketingOptInUserSchemaSafeParseMock.mockImplementation((input) => ({
      success: true,
      data: input,
    }));
    stripeCreateUserCustomerMock.mockResolvedValue(undefined);
    postmarkSendEmailMock.mockResolvedValue({ MessageID: "message_123" });
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    renderMagicLinkEmailMock.mockResolvedValue({
      html: "<html>magic link</html>",
      subject: "Sokosumi - Sign in to your account",
    });
    renderOrganizationInvitationEmailMock.mockResolvedValue({
      html: "<html>organization invitation</html>",
      subject: "Sokosumi - Organization Invitation",
    });
    renderResetPasswordEmailMock.mockResolvedValue({
      html: "<html>reset password</html>",
      subject: "Sokosumi - Passwort zurücksetzen",
    });
    renderVerificationEmailMock.mockResolvedValue({
      html: "<html>verification email</html>",
      subject: "Sokosumi - E-Mail-Adresse bestätigen",
    });
    stripePluginMock.mockReturnValue("stripe-plugin");
  });

  it("uses the canonical production URL for the OAuth proxy", async () => {
    getBetterAuthProductionUrlMock.mockReturnValue(
      "https://canonical.example.com",
    );

    await import("../auth");

    expect(oAuthProxyPluginMock).toHaveBeenCalledWith({
      productionURL: "https://canonical.example.com",
    });
  });

  it("disables cross-subdomain cookies on localhost", async () => {
    getEnvSecretsMock.mockReturnValue({
      ...getDefaultEnvSecrets(),
      BETTER_AUTH_URL: "http://localhost:3000/auth",
      WEB_APP_BASE_URL: "http://localhost:3000",
    });

    await import("../auth");

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

  it("uses the mainnet cookie prefix from NETWORK", async () => {
    getEnvSecretsMock.mockReturnValue({
      ...getDefaultEnvSecrets(),
      BETTER_AUTH_URL: "https://app.sokosumi.com/auth",
      NETWORK: "Mainnet",
      VERCEL_ENV: "production",
      WEB_APP_BASE_URL: "https://app.sokosumi.com",
    });

    await import("../auth");

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
    expect(lastLoginMethodPluginMock).toHaveBeenCalledWith({
      cookieName: "sokosumi.last_used_login_method",
    });
  });

  it("uses the configured cookie domain when provided", async () => {
    getEnvSecretsMock.mockReturnValue({
      ...getDefaultEnvSecrets(),
      BETTER_AUTH_COOKIE_DOMAIN: "preview.sokosumi.com",
      BETTER_AUTH_URL: "https://preprod.sokosumi.com/auth",
      VERCEL_ENV: "production",
      WEB_APP_BASE_URL: "https://preprod.sokosumi.com",
    });

    await import("../auth");

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

  it("uses the configured cookie domain for previews when provided", async () => {
    getEnvSecretsMock.mockReturnValue({
      ...getDefaultEnvSecrets(),
      BETTER_AUTH_COOKIE_DOMAIN: "sokosumi.com",
      BETTER_AUTH_URL:
        "https://sokosumi-app-preprod-git-feature-123.preview.sokosumi.com/auth",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/123",
      WEB_APP_BASE_URL: "https://feature-123.preview.sokosumi.com",
    });

    await import("../auth");

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
      domain: "sokosumi.com",
    });
    expect(config.advanced.cookiePrefix).toBe(
      "sokosumi-preview-preprod-feature-123",
    );
  });

  it("uses the git commit ref to keep preview cookie prefixes stable", async () => {
    getEnvSecretsMock.mockReturnValue({
      ...getDefaultEnvSecrets(),
      BETTER_AUTH_URL: "https://fallback.sokosumi.com/auth",
      NETWORK: "Mainnet",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature_branch-123-team",
      VERCEL_URL: "https://deployment-abc.vercel.app",
      WEB_APP_BASE_URL: "https://deployment-abc.vercel.app",
    });

    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          advanced: {
            cookiePrefix?: string;
          };
        },
      ]
    >;

    expect(config.advanced.cookiePrefix).toBe(
      "sokosumi-preview-mainnet-feature-branch-123-team",
    );
  });

  it("falls back to the network-specific preview prefix when preview commit ref is empty", async () => {
    getEnvSecretsMock.mockReturnValue({
      ...getDefaultEnvSecrets(),
      BETTER_AUTH_URL: "https://deployment-abc.vercel.app/auth",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "",
      VERCEL_URL: "https://deployment-abc.vercel.app",
      WEB_APP_BASE_URL: "https://deployment-abc.vercel.app",
    });

    await import("../auth");

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

  it("prefers the locale cookie over accept-language for magic-link emails", async () => {
    await import("../auth");

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
        cookie: "sokosumi.locale=es",
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
          cookie: "sokosumi.locale=es",
        }),
        request,
      },
    );

    expect(renderMagicLinkEmailMock).toHaveBeenCalledWith({
      locale: "es",
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

  it("registers the passkey plugin with the Sokosumi relying party configuration", async () => {
    await import("../auth");

    expect(passkeyPluginMock).toHaveBeenCalledWith({
      rpID: "example.com",
      rpName: "Sokosumi",
    });
  });

  it("passes the resolved locale to the reset-password email renderer", async () => {
    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          emailAndPassword: {
            sendResetPassword: (
              data: {
                url: string;
                user: {
                  email: string;
                  name: string;
                };
              },
              request?: Request,
            ) => Promise<void>;
          };
        },
      ]
    >;

    const request = new Request(
      "https://example.com/auth/request-password-reset",
      {
        headers: {
          "accept-language": "de-DE,de;q=0.9",
          cookie: "sokosumi.locale=de",
        },
      },
    );

    await config.emailAndPassword.sendResetPassword(
      {
        url: "https://example.com/reset-password",
        user: {
          email: "andreas@example.com",
          name: "Andreas",
        },
      },
      request,
    );

    expect(renderResetPasswordEmailMock).toHaveBeenCalledWith({
      locale: "de",
      name: "Andreas",
      resetLink: "https://example.com/reset-password",
    });
  });

  it("passes the resolved locale to the verification email renderer", async () => {
    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          emailVerification: {
            sendVerificationEmail: (
              data: {
                url: string;
                user: {
                  email: string;
                  name: string;
                };
              },
              request?: Request,
            ) => Promise<void>;
          };
        },
      ]
    >;

    const request = new Request(
      "https://example.com/auth/send-verification-email",
      {
        headers: {
          "accept-language": "de-DE,de;q=0.9",
          cookie: "sokosumi.locale=de",
        },
      },
    );

    await config.emailVerification.sendVerificationEmail(
      {
        url: "https://example.com/verify-email",
        user: {
          email: "andreas@example.com",
          name: "Andreas",
        },
      },
      request,
    );

    expect(renderVerificationEmailMock).toHaveBeenCalledWith({
      locale: "de",
      name: "Andreas",
      verificationLink: "https://example.com/verify-email",
    });
  });

  it("passes the resolved locale to the invitation email renderer", async () => {
    await import("../auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          sendInvitationEmail: (
            data: {
              email: string;
              id: string;
              inviter: {
                user: {
                  name: string;
                };
              };
              organization: {
                name: string;
              };
            },
            request?: Request,
          ) => Promise<void>;
        },
      ]
    >;

    const request = new Request("https://example.com/auth/send-invitation", {
      headers: {
        "accept-language": "de-DE,de;q=0.9",
        cookie: "sokosumi.locale=de",
      },
    });

    await config.sendInvitationEmail(
      {
        email: "invitee@example.com",
        id: "invite_123",
        inviter: {
          user: {
            name: "Andreas",
          },
        },
        organization: {
          name: "Sokosumi Org",
        },
      },
      request,
    );

    expect(renderOrganizationInvitationEmailMock).toHaveBeenCalledWith({
      invitationLink: "https://example.com/auth/accept-invitation/invite_123",
      invitorUsername: "Andreas",
      locale: "de",
      organizationName: "Sokosumi Org",
    });
  });

  it("uses the legacy locale cookie alias for magic-link emails", async () => {
    await import("../auth");

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
        "accept-language": "en-US,en;q=0.9",
      },
    });

    await config.sendMagicLink(
      {
        email: "andreas@example.com",
        token: "secret-token",
        url: "https://example.com/auth/magic-link/verify?token=secret",
      },
      {
        body: {
          name: "Andreas",
        },
        headers: new Headers({
          cookie: "locale=de",
        }),
        request,
      },
    );

    expect(renderMagicLinkEmailMock).toHaveBeenCalledWith({
      locale: "de",
      name: "Andreas",
      magicLink: "https://example.com/auth/magic-link/verify?token=secret",
    });
  });

  it("stores the email prefix when a new user is created without a name", async () => {
    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                before: (user: {
                  email: string;
                  marketingOptIn: boolean;
                  name: string;
                }) => Promise<{
                  data: {
                    email: string;
                    marketingOptIn: boolean;
                    name: string;
                  };
                }>;
                after: (user: {
                  id: string;
                  email: string;
                  marketingOptIn: boolean;
                  name: string;
                }) => Promise<void>;
              };
              update: {
                after: (user: {
                  id: string;
                  email: string;
                  marketingOptIn: boolean;
                  name: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    const user = {
      id: "user_123",
      email: "magic@example.com",
      marketingOptIn: true,
      name: "   ",
    };

    const normalizedCreate =
      await config.databaseHooks.user.create.before(user);
    const normalizedUser = normalizedCreate.data as typeof user & {
      id: string;
    };

    expect(normalizedCreate).toEqual({
      data: {
        ...user,
        name: "magic",
      },
    });

    await config.databaseHooks.user.create.after(normalizedUser);
    await config.databaseHooks.user.update.after(normalizedUser);

    expect(marketingOptInUserSchemaSafeParseMock).toHaveBeenNthCalledWith(1, {
      ...user,
      name: "magic",
    });
    expect(marketingOptInUserSchemaSafeParseMock).toHaveBeenNthCalledWith(2, {
      ...user,
      name: "magic",
    });
    expect(callUserCreatedWebHookMock).toHaveBeenCalledWith(
      "user_123",
      "magic@example.com",
      "magic",
      true,
    );
    expect(callUserUpdatedWebHookMock).toHaveBeenCalledWith(
      "user_123",
      "magic@example.com",
      "magic",
      true,
    );
  });

  it("falls back to the full email when the local part is empty", async () => {
    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                before: (user: {
                  email: string;
                  marketingOptIn: boolean;
                  name: string;
                }) => Promise<{
                  data: {
                    email: string;
                    marketingOptIn: boolean;
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
      marketingOptIn: true,
      name: "",
    });

    expect(normalizedCreate).toEqual({
      data: {
        email: "@example.com",
        marketingOptIn: true,
        name: "@example.com",
      },
    });
  });
});
