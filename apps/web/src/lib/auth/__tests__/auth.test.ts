export {};

const adminPluginMock = jest.fn();
const apiKeyPluginMock = jest.fn();
const betterAuthMock = jest.fn();
const createAuthMiddlewareMock = jest.fn((callback) => callback);
const getEnvPublicConfigMock = jest.fn();
const getEnvSecretsMock = jest.fn();
const getInfraAuthPluginsMock = jest.fn();
const i18nPluginMock = jest.fn();
const jwtPluginMock = jest.fn();
const lastLoginMethodPluginMock = jest.fn();
const magicLinkPluginMock = jest.fn();
const nextCookiesPluginMock = jest.fn();
const oauthProviderPluginMock = jest.fn();
const organizationPluginMock = jest.fn();
const postmarkSendEmailMock = jest.fn();
const prismaAdapterMock = jest.fn();
const renderMagicLinkEmailMock = jest.fn();
const stripePluginMock = jest.fn();
const stripeSdkMock = jest.fn(() => ({ __stripe: true }));

jest.mock("server-only", () => ({}));

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

jest.mock("@better-auth/api-key", () => ({
  apiKey: (...args: unknown[]) => apiKeyPluginMock(...args),
}));

jest.mock("@better-auth/i18n", () => ({
  i18n: (...args: unknown[]) => i18nPluginMock(...args),
}));

jest.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: (...args: unknown[]) => oauthProviderPluginMock(...args),
}));

jest.mock("@better-auth/prisma-adapter", () => ({
  prismaAdapter: (...args: unknown[]) => prismaAdapterMock(...args),
}));

jest.mock("@better-auth/stripe", () => ({
  stripe: (...args: unknown[]) => stripePluginMock(...args),
}));

jest.mock("better-auth/api", () => {
  class MockApiError extends Error {}

  return {
    APIError: MockApiError,
    createAuthMiddleware: (...args: unknown[]) =>
      createAuthMiddlewareMock(...args),
  };
});

jest.mock("better-auth/minimal", () => ({
  betterAuth: (...args: unknown[]) => betterAuthMock(...args),
}));

jest.mock("better-auth/next-js", () => ({
  nextCookies: (...args: unknown[]) => nextCookiesPluginMock(...args),
}));

jest.mock("better-auth/plugins", () => ({
  admin: (...args: unknown[]) => adminPluginMock(...args),
  jwt: (...args: unknown[]) => jwtPluginMock(...args),
  lastLoginMethod: (...args: unknown[]) => lastLoginMethodPluginMock(...args),
  magicLink: (...args: unknown[]) => magicLinkPluginMock(...args),
  organization: (...args: unknown[]) => organizationPluginMock(...args),
}));

jest.mock("stripe", () => ({
  __esModule: true,
  default: stripeSdkMock,
}));

jest.mock("@sokosumi/database", () => ({
  MemberRole: {
    ADMIN: "ADMIN",
    OWNER: "OWNER",
  },
  User: {},
}));

jest.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: jest.fn(),
  },
}));

jest.mock("@sokosumi/email", () => ({
  renderMagicLinkEmail: (...args: unknown[]) =>
    renderMagicLinkEmailMock(...args),
  renderOrganizationInvitationEmail: jest.fn(),
  renderResetPasswordEmail: jest.fn(),
  renderVerificationEmail: jest.fn(),
}));

jest.mock("@sokosumi/masumi/auth", () => ({
  authTranslations: {},
}));

jest.mock("p-timeout", () => ({
  __esModule: true,
  default: (promise: Promise<unknown>) => promise,
}));

jest.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

jest.mock("@/lib/auth/infra-plugins", () => ({
  getInfraAuthPlugins: (...args: unknown[]) => getInfraAuthPluginsMock(...args),
}));

jest.mock("@/lib/blob/utils", () => ({
  uploadProfileImage: jest.fn(),
}));

jest.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: { __prisma: true },
}));

jest.mock("@/lib/email/postmark", () => ({
  postmarkClient: {
    sendEmail: (...args: unknown[]) => postmarkSendEmailMock(...args),
  },
}));

jest.mock("@/lib/schemas", () => ({
  marketingOptInUserSchema: {
    safeParse: jest.fn(),
  },
}));

jest.mock("@/lib/services", () => ({
  callAccountCreatedWebHook: jest.fn(),
  callUserCreatedWebHook: jest.fn(),
  callUserUpdatedWebHook: jest.fn(),
  organizationSubscriptionService: {
    ensureCanAcceptInvitation: jest.fn(),
    ensureCanCreateInvitation: jest.fn(),
  },
  preferredOrganizationService: {
    resolveActiveOrganizationIdForSession: jest.fn(),
  },
  stripeService: {},
}));

jest.mock("@/lib/stripe/subscription-catalog", () => ({
  getBetterAuthSubscriptionPlans: jest.fn(),
}));

jest.mock("@/lib/stripe/webhook-handlers", () => ({
  handleCustomerCreatedEvent: jest.fn(),
  handleCustomerUpdatedEvent: jest.fn(),
  handleInvoicePaidEvent: jest.fn(),
}));

describe("web auth config", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    adminPluginMock.mockReturnValue("admin-plugin");
    apiKeyPluginMock.mockReturnValue("api-key-plugin");
    betterAuthMock.mockReturnValue({ api: {}, handler: jest.fn() });
    getEnvPublicConfigMock.mockReturnValue({
      NEXT_PUBLIC_PASSWORD_MAX_LENGTH: 128,
      NEXT_PUBLIC_PASSWORD_MIN_LENGTH: 12,
    });
    getEnvSecretsMock.mockReturnValue({
      BETTER_AUTH_API_KEY: "test-api-key",
      BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN: 900,
      BETTER_AUTH_ORG_INVITATION_EXPIRES_IN: 86_400,
      BETTER_AUTH_ORG_INVITATION_LIMIT: 10,
      BETTER_AUTH_ORG_LIMIT: 5,
      BETTER_AUTH_PROFILE_PICTURE_TIMEOUT: 5_000,
      BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: 60,
      BETTER_AUTH_TRUSTED_ORIGIN: "https://example.com",
      BETTER_AUTH_URL: "https://example.com/auth",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      MICROSOFT_CLIENT_ID: "microsoft-client-id",
      MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
      POSTMARK_FROM_EMAIL: "no-reply@example.com",
      STRIPE_SECRET_KEY: "sk_test_123",
      STRIPE_WEBHOOK_SECRET: "whsec_123",
      VERCEL_BRANCH_URL: "",
      VERCEL_URL: "",
    });
    getInfraAuthPluginsMock.mockReturnValue([]);
    i18nPluginMock.mockReturnValue("i18n-plugin");
    jwtPluginMock.mockReturnValue("jwt-plugin");
    lastLoginMethodPluginMock.mockReturnValue("last-login-method-plugin");
    magicLinkPluginMock.mockReturnValue("magic-link-plugin");
    nextCookiesPluginMock.mockReturnValue("next-cookies-plugin");
    oauthProviderPluginMock.mockReturnValue("oauth-provider-plugin");
    organizationPluginMock.mockReturnValue("organization-plugin");
    postmarkSendEmailMock.mockResolvedValue({ MessageID: "message_123" });
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    renderMagicLinkEmailMock.mockResolvedValue({
      html: "<html>magic link</html>",
      subject: "Sokosumi - Sign in to your account",
    });
    stripePluginMock.mockReturnValue("stripe-plugin");
  });

  it("passes the magic-link token to the shared email renderer", async () => {
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

    expect(renderMagicLinkEmailMock).toHaveBeenCalledWith({
      magicLink: "https://example.com/auth/magic-link/verify?token=secret",
      name: "Andreas",
      token: "secret-token",
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
});
