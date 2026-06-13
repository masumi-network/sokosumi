import { beforeEach, describe, expect, it, vi } from "vitest";

const adminPluginMock = vi.fn();
const apiKeyPluginMock = vi.fn();
const betterAuthMock = vi.fn();
const createAuthMiddlewareMock = vi.fn((callback) => callback);
const getBetterAuthProductionUrlMock = vi.fn();
const getEnvPublicConfigMock = vi.fn();
const getEnvSecretsMock = vi.fn();
const i18nPluginMock = vi.fn();
const ensureInitialLocalFreeSubscriptionPeriodMock = vi.fn();
const assertPersonalSubscriptionChangeAllowedMock = vi.fn();
const hasConsumableEnterpriseContractMock = vi.fn();
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
const prismaOrganizationUpdateMock = vi.fn();
const prismaTransactionMock = vi.fn();
const prismaUserUpdateMock = vi.fn();
const getMembersByOrganizationIdMock = vi.fn();
const renderMagicLinkEmailMock = vi.fn();
const syncLocalFreeSeatsAndCreditsForCurrentMembersMock = vi.fn();
const stripeCreateOrganizationCustomerMock = vi.fn();
const stripeCreateUserCustomerMock = vi.fn();
const stripePluginMock = vi.fn();
const stripeSdkMock = vi.fn(function MockStripe() {
  return { __stripe: true };
});
const sentryCaptureExceptionMock = vi.fn();
const handleSubscriptionDeletedEventMock = vi.fn();
const reconcileActiveStripeBackedSubscriptionMock = vi.fn();
const workspaceUpsertMock = vi.fn();

function getDefaultEnvSecrets() {
  return {
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
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
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
  class MockApiError extends Error {
    code?: string;
    status: string;

    constructor(status: string, options?: { code?: string; message?: string }) {
      super(options?.message ?? status);
      this.name = "APIError";
      this.code = options?.code;
      this.status = status;
    }
  }

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
    getMembersByOrganizationId: (...args: unknown[]) =>
      getMembersByOrganizationIdMock(...args),
    getMemberByUserIdAndOrganizationId: vi.fn(),
  },
  workspaceRepository: {
    upsertOrganizationWorkspace: (...args: unknown[]) =>
      workspaceUpsertMock(...args),
    upsertPersonalWorkspace: (...args: unknown[]) =>
      workspaceUpsertMock(...args),
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  assertPersonalSubscriptionChangeAllowed: (...args: unknown[]) =>
    assertPersonalSubscriptionChangeAllowedMock(...args),
  ensureInitialLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    ensureInitialLocalFreeSubscriptionPeriodMock(...args),
  hasConsumableEnterpriseContract: (...args: unknown[]) =>
    hasConsumableEnterpriseContractMock(...args),
  OrganizationSubscriptionExclusivityError: class OrganizationSubscriptionExclusivityError extends Error {
    override readonly name = "OrganizationSubscriptionExclusivityError";
  },
  ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE:
    "This organization has an active enterprise contract. Self-serve subscriptions are not available.",
  PERSONAL_SUBSCRIPTION_ENTERPRISE_EXCLUSIVITY_MESSAGE:
    "You belong to an organization with an active enterprise contract. Personal self-serve subscriptions are not available.",
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

vi.mock("@/lib/blob/utils", () => ({
  uploadProfileImage: vi.fn(),
}));

vi.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: (...args: unknown[]) =>
      stripeCreateOrganizationCustomerMock(...args),
    createUserCustomer: (...args: unknown[]) =>
      stripeCreateUserCustomerMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    __prisma: true,
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
    organization: {
      update: (...args: unknown[]) => prismaOrganizationUpdateMock(...args),
    },
    user: {
      update: (...args: unknown[]) => prismaUserUpdateMock(...args),
    },
  },
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
    syncLocalFreeSeatsAndCreditsForCurrentMembers: (...args: unknown[]) =>
      syncLocalFreeSeatsAndCreditsForCurrentMembersMock(...args),
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
  handleSubscriptionDeletedEvent: (...args: unknown[]) =>
    handleSubscriptionDeletedEventMock(...args),
  reconcileActiveStripeBackedSubscription: (...args: unknown[]) =>
    reconcileActiveStripeBackedSubscriptionMock(...args),
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
    ensureInitialLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);
    assertPersonalSubscriptionChangeAllowedMock.mockResolvedValue(undefined);
    hasConsumableEnterpriseContractMock.mockResolvedValue(false);
    prismaTransactionMock.mockImplementation(
      async (callback) => await callback({ __tx: true }),
    );
    prismaOrganizationUpdateMock.mockResolvedValue(undefined);
    prismaUserUpdateMock.mockResolvedValue(undefined);
    stripeCreateOrganizationCustomerMock.mockResolvedValue({
      id: "cus_org_1",
    });
    stripeCreateUserCustomerMock.mockResolvedValue({ id: "cus_user_1" });
    workspaceUpsertMock.mockResolvedValue({ id: "workspace_123" });
    syncLocalFreeSeatsAndCreditsForCurrentMembersMock.mockResolvedValue(
      undefined,
    );
    postmarkSendEmailMock.mockResolvedValue({ MessageID: "message_123" });
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    getMembersByOrganizationIdMock.mockReset();
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
    handleSubscriptionDeletedEventMock.mockResolvedValue(undefined);
    sentryCaptureExceptionMock.mockReset();
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

  it("enables Better Auth cookie cache for web sessions", async () => {
    await import("../auth");

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

  it("configures subscription checkout for billing, tax IDs, and customer updates", async () => {
    await import("../auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [
        {
          subscription: {
            getCheckoutSessionParams: () => Promise<{
              params?: {
                billing_address_collection?: string;
                customer_update?: {
                  address?: string;
                  name?: string;
                };
                tax_id_collection?: {
                  enabled: boolean;
                };
              };
            }>;
          };
        },
      ]
    >;

    const sessionParams = await config.subscription.getCheckoutSessionParams();

    expect(sessionParams).toEqual({
      params: {
        billing_address_collection: "required",
        customer_update: {
          address: "auto",
          name: "auto",
        },
        tax_id_collection: {
          enabled: true,
        },
      },
    });
  });

  it("handles customer.subscription.deleted via the Stripe webhook handlers", async () => {
    await import("../auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [
        {
          onEvent: (event: {
            data: {
              object: {
                id: string;
              };
            };
            id: string;
            type: string;
          }) => Promise<void>;
        },
      ]
    >;

    await config.onEvent({
      data: {
        object: {
          id: "sub_123",
        },
      },
      id: "evt_123",
      type: "customer.subscription.deleted",
    });

    expect(handleSubscriptionDeletedEventMock).toHaveBeenCalledWith({
      id: "sub_123",
    });
  });

  it.each([
    "onSubscriptionCreated",
    "onSubscriptionUpdate",
  ] as const)("reconciles local free rows from Better Auth subscription callback %s", async (callbackName) => {
    await import("../auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [
        {
          subscription: {
            onSubscriptionCreated: (params: {
              event: {
                id: string;
                type: string;
              };
              subscription: {
                id: string;
                referenceId: string;
                stripeSubscriptionId?: string | null;
              };
            }) => Promise<void>;
            onSubscriptionUpdate: (params: {
              event: {
                id: string;
                type: string;
              };
              subscription: {
                id: string;
                referenceId: string;
                stripeSubscriptionId?: string | null;
              };
            }) => Promise<void>;
          };
        },
      ]
    >;

    const subscription = {
      id: "sub_local_enterprise",
      referenceId: "org-enterprise",
      stripeSubscriptionId: "sub_enterprise",
    };

    await config.subscription[callbackName]({
      event: {
        id: "evt_enterprise",
        type:
          callbackName === "onSubscriptionCreated"
            ? "customer.subscription.created"
            : "customer.subscription.updated",
      },
      subscription,
    });

    expect(reconcileActiveStripeBackedSubscriptionMock).toHaveBeenCalledWith(
      subscription,
    );
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

  it("blocks organization deletion when additional members remain", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
    ]);

    await import("../auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            beforeDeleteOrganization: (input: {
              organization: { id: string };
              user: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await expect(
      config.organizationHooks.beforeDeleteOrganization({
        organization: { id: "org-1" },
        user: { id: "user-1" },
      }),
    ).rejects.toMatchObject({
      code: "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
      message: "Remove all other members before deleting this organization.",
      status: "BAD_REQUEST",
    });

    expect(getMembersByOrganizationIdMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        __prisma: true,
      }),
    );
  });

  it("allows organization deletion when the current user is the only member", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([{ userId: "user-1" }]);

    await import("../auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            beforeDeleteOrganization: (input: {
              organization: { id: string };
              user: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await expect(
      config.organizationHooks.beforeDeleteOrganization({
        organization: { id: "org-1" },
        user: { id: "user-1" },
      }),
    ).resolves.toBeUndefined();
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
      createdAt: new Date("2026-04-08T00:00:00.000Z"),
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

    expect(workspaceUpsertMock).toHaveBeenCalledWith({
      tx: expect.objectContaining({ __prisma: true }),
      userId: "user_123",
    });
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
    expect(ensureInitialLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith(
      "user_123",
      "magic",
      "magic@example.com",
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

  it("creates a local free organization subscription and Stripe customer", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { role: "owner", userId: "user-1" },
      { role: "member", userId: "user-2" },
    ]);

    await import("../auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterCreateOrganization: (input: {
              member: { userId: string };
              organization: {
                createdAt?: Date;
                id: string;
                metadata?: string | null;
                name: string;
                slug: string;
              };
              user: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.afterCreateOrganization({
      member: { userId: "user-1" },
      organization: {
        createdAt: new Date("2026-04-08T00:00:00.000Z"),
        id: "org-1",
        metadata: null,
        name: "Org One",
        slug: "org-one",
      },
      user: { id: "user-1" },
    });

    expect(workspaceUpsertMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      tx: expect.objectContaining({ __prisma: true }),
    });
    expect(ensureInitialLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(stripeCreateOrganizationCustomerMock).toHaveBeenCalledWith(
      "org-1",
      "org-one",
      "Org One",
      null,
    );
  });

  it("reports workspace creation failures to Sentry without blocking user creation", async () => {
    workspaceUpsertMock.mockRejectedValueOnce(new Error("workspace failed"));

    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                after: (user: {
                  email: string;
                  id: string;
                  marketingOptIn: boolean;
                  name: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await config.databaseHooks.user.create.after({
      email: "magic@example.com",
      id: "user_123",
      marketingOptIn: true,
      name: "magic",
    });

    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        email: "magic@example.com",
        name: "magic",
        userId: "user_123",
      },
      tags: {
        context: "workspace_user_creation",
      },
    });
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith(
      "user_123",
      "magic",
      "magic@example.com",
    );
    expect(callUserCreatedWebHookMock).toHaveBeenCalledWith(
      "user_123",
      "magic@example.com",
      "magic",
      true,
    );
  });

  it("does not block user creation on a pending Stripe customer request", async () => {
    let resolveStripeCustomerCreation:
      | ((value: { id: string }) => void)
      | null = null;
    stripeCreateUserCustomerMock.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveStripeCustomerCreation = resolve;
        }),
    );

    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                after: (user: {
                  email: string;
                  id: string;
                  marketingOptIn: boolean;
                  name: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    let settled = false;

    const afterPromise = config.databaseHooks.user.create.after({
      email: "magic@example.com",
      id: "user_123",
      marketingOptIn: true,
      name: "magic",
    });
    afterPromise.then(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(settled).toBe(true);
    });
    expect(workspaceUpsertMock).toHaveBeenCalledWith({
      tx: expect.objectContaining({ __prisma: true }),
      userId: "user_123",
    });
    expect(callUserCreatedWebHookMock).toHaveBeenCalledWith(
      "user_123",
      "magic@example.com",
      "magic",
      true,
    );

    const resolvePendingUserStripeCustomer = resolveStripeCustomerCreation as
      | ((value: { id: string }) => void)
      | null;
    if (resolvePendingUserStripeCustomer) {
      resolvePendingUserStripeCustomer({ id: "cus_user_pending" });
    }
    await afterPromise;
  });

  it("does not block organization creation on a pending Stripe customer request", async () => {
    let resolveStripeCustomerCreation:
      | ((value: { id: string }) => void)
      | null = null;
    stripeCreateOrganizationCustomerMock.mockImplementation(
      () =>
        new Promise<{ id: string }>((resolve) => {
          resolveStripeCustomerCreation = resolve;
        }),
    );

    await import("../auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterCreateOrganization: (input: {
              member: { userId: string };
              organization: {
                createdAt?: Date;
                id: string;
                metadata?: string | null;
                name: string;
                slug: string;
              };
              user: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    let settled = false;

    const afterPromise = config.organizationHooks.afterCreateOrganization({
      member: { userId: "user-1" },
      organization: {
        createdAt: new Date("2026-04-08T00:00:00.000Z"),
        id: "org-1",
        metadata: null,
        name: "Org One",
        slug: "org-one",
      },
      user: { id: "user-1" },
    });
    afterPromise.then(() => {
      settled = true;
    });

    await vi.waitFor(() => {
      expect(settled).toBe(true);
    });
    expect(workspaceUpsertMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      tx: expect.objectContaining({ __prisma: true }),
    });
    expect(stripeCreateOrganizationCustomerMock).toHaveBeenCalledWith(
      "org-1",
      "org-one",
      "Org One",
      null,
    );

    const resolvePendingOrganizationStripeCustomer =
      resolveStripeCustomerCreation as ((value: { id: string }) => void) | null;
    if (resolvePendingOrganizationStripeCustomer) {
      resolvePendingOrganizationStripeCustomer({ id: "cus_org_pending" });
    }
    await afterPromise;
  });

  it("reports organization workspace creation failures to Sentry without blocking organization creation", async () => {
    workspaceUpsertMock.mockRejectedValueOnce(new Error("workspace failed"));

    await import("../auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterCreateOrganization: (input: {
              member: { userId: string };
              organization: {
                createdAt?: Date;
                id: string;
                metadata?: string | null;
                name: string;
                slug: string;
              };
              user: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.afterCreateOrganization({
      member: { userId: "user-1" },
      organization: {
        createdAt: new Date("2026-04-08T00:00:00.000Z"),
        id: "org-1",
        metadata: null,
        name: "Org One",
        slug: "org-one",
      },
      user: { id: "user-1" },
    });

    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        organizationId: "org-1",
        organizationName: "Org One",
        organizationSlug: "org-one",
      },
      tags: {
        context: "workspace_organization_creation",
      },
    });
    expect(stripeCreateOrganizationCustomerMock).toHaveBeenCalledWith(
      "org-1",
      "org-one",
      "Org One",
      null,
    );
  });

  it("syncs local free organization seats and credits after accepting an invitation", async () => {
    await import("../auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterAcceptInvitation: (input: {
              invitation: { id: string };
              member: { userId: string };
              organization: { id: string };
              user: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.afterAcceptInvitation({
      invitation: { id: "invite-1" },
      member: { userId: "user-2" },
      organization: { id: "org-1" },
      user: { id: "user-2" },
    });

    expect(
      syncLocalFreeSeatsAndCreditsForCurrentMembersMock,
    ).toHaveBeenCalledWith("org-1");
  });

  it("syncs local free organization seats and credits after adding a member", async () => {
    await import("../auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterAddMember: (input: {
              member: { userId: string };
              organization: { id: string };
              user: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.afterAddMember({
      member: { userId: "user-2" },
      organization: { id: "org-1" },
      user: { id: "user-1" },
    });

    expect(
      syncLocalFreeSeatsAndCreditsForCurrentMembersMock,
    ).toHaveBeenCalledWith("org-1");
  });

  it("allows personal /subscription/upgrade when enterprise exclusivity does not apply", async () => {
    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          hooks: {
            before: (ctx: {
              body?: Record<string, unknown>;
              context: { session?: { user: { id: string } } };
              path: string;
            }) => Promise<void>;
          };
        },
      ]
    >;

    await expect(
      config.hooks.before({
        body: { customerType: "user", plan: "pro" },
        context: { session: { user: { id: "user-1" } } },
        path: "/subscription/upgrade",
      }),
    ).resolves.toBeUndefined();

    expect(assertPersonalSubscriptionChangeAllowedMock).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ __prisma: true }),
    );
  });

  it("blocks personal /subscription/upgrade for enterprise-contract members", async () => {
    const { OrganizationSubscriptionExclusivityError } = await import(
      "@sokosumi/database/helpers"
    );
    assertPersonalSubscriptionChangeAllowedMock.mockRejectedValueOnce(
      new OrganizationSubscriptionExclusivityError(
        "You belong to an organization with an active enterprise contract. Personal self-serve subscriptions are not available.",
      ),
    );

    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          hooks: {
            before: (ctx: {
              body?: Record<string, unknown>;
              context: { session?: { user: { id: string } } };
              path: string;
            }) => Promise<void>;
          };
        },
      ]
    >;

    await expect(
      config.hooks.before({
        body: { customerType: "user", plan: "pro" },
        context: { session: { user: { id: "user-1" } } },
        path: "/subscription/upgrade",
      }),
    ).rejects.toMatchObject({
      code: "PERSONAL_SUBSCRIPTION_ENTERPRISE_CONTRACT_EXCLUSIVE",
      status: "BAD_REQUEST",
    });
  });

  it("does not run personal enterprise exclusivity for organization upgrades", async () => {
    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          hooks: {
            before: (ctx: {
              body?: Record<string, unknown>;
              context: { session?: { user: { id: string } } };
              path: string;
            }) => Promise<void>;
          };
        },
      ]
    >;

    await expect(
      config.hooks.before({
        body: {
          customerType: "organization",
          plan: "pro",
          referenceId: "org-1",
        },
        context: { session: { user: { id: "user-1" } } },
        path: "/subscription/upgrade",
      }),
    ).resolves.toBeUndefined();

    expect(assertPersonalSubscriptionChangeAllowedMock).not.toHaveBeenCalled();
  });

  it("allows /subscription/upgrade for self-serve plans", async () => {
    await import("../auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          hooks: {
            before: (ctx: {
              body?: Record<string, unknown>;
              path: string;
            }) => Promise<void>;
          };
        },
      ]
    >;

    await expect(
      config.hooks.before({
        body: { plan: "pro" },
        path: "/subscription/upgrade",
      }),
    ).resolves.toBeUndefined();
  });
});
