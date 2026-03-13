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
const marketingOptInUserSchemaSafeParseMock = jest.fn();
const nextCookiesPluginMock = jest.fn();
const oauthProviderPluginMock = jest.fn();
const organizationPluginMock = jest.fn();
const renderOrganizationInvitationEmailMock = jest.fn();
const renderResetPasswordEmailMock = jest.fn();
const renderVerificationEmailMock = jest.fn();
const callUserCreatedWebHookMock = jest.fn();
const callUserUpdatedWebHookMock = jest.fn();
const postmarkSendEmailMock = jest.fn();
const prismaAdapterMock = jest.fn();
const renderMagicLinkEmailMock = jest.fn();
const stripeCreateUserCustomerMock = jest.fn();
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
  renderOrganizationInvitationEmail: (...args: unknown[]) =>
    renderOrganizationInvitationEmailMock(...args),
  renderResetPasswordEmail: (...args: unknown[]) =>
    renderResetPasswordEmailMock(...args),
  renderVerificationEmail: (...args: unknown[]) =>
    renderVerificationEmailMock(...args),
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
    createUserCustomer: (...args: unknown[]) =>
      stripeCreateUserCustomerMock(...args),
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
    safeParse: (...args: unknown[]) =>
      marketingOptInUserSchemaSafeParseMock(...args),
  },
}));

jest.mock("@/lib/services", () => ({
  callAccountCreatedWebHook: jest.fn(),
  callUserCreatedWebHook: (...args: unknown[]) =>
    callUserCreatedWebHookMock(...args),
  callUserUpdatedWebHook: (...args: unknown[]) =>
    callUserUpdatedWebHookMock(...args),
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
        cookie: "sokosumi.locale=fr",
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
          cookie: "sokosumi.locale=fr",
        }),
        request,
      },
    );

    expect(renderMagicLinkEmailMock).toHaveBeenCalledWith({
      locale: "fr",
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
      locale: "de-DE",
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
      locale: "de-DE",
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
      locale: "de-DE",
      organizationName: "Sokosumi Org",
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

    expect(normalizedCreate).toEqual({
      data: {
        ...user,
        name: "magic",
      },
    });

    await config.databaseHooks.user.create.after(normalizedCreate.data);
    await config.databaseHooks.user.update.after(normalizedCreate.data);

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
