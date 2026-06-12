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
  lastLoginMethodPluginMock,
  oauthProviderPluginMock,
  oAuthProxyPluginMock,
  openAPIPluginMock,
  organizationPluginMock,
  magicLinkPluginMock,
  mapProfileToUserMock,
  passkeyPluginMock,
  postmarkSendEmailMock,
  prismaAdapterMock,
  renderMagicLinkEmailMock,
  renderOrganizationInvitationEmailMock,
  renderResetPasswordEmailMock,
  renderVerificationEmailMock,
  resolveActiveOrganizationIdForSessionMock,
  sentryCaptureExceptionMock,
  stripeCreateOrganizationCustomerMock,
  stripeCreateUserCustomerMock,
  stripePluginMock,
  syncSeatsAndCreditsMock,
  ensureCanAcceptInvitationMock,
  getMembersByOrganizationIdMock,
  getMemberByUserIdAndOrganizationIdMock,
  getBetterAuthSubscriptionPlansMock,
  syncUserEmailWithStripeMock,
  webhookCallAccountCreatedMock,
  webhookCallUserCreatedMock,
  webhookCallUserUpdatedMock,
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
  lastLoginMethodPluginMock: vi.fn(),
  oauthProviderPluginMock: vi.fn(),
  oAuthProxyPluginMock: vi.fn(),
  openAPIPluginMock: vi.fn(),
  organizationPluginMock: vi.fn(),
  magicLinkPluginMock: vi.fn(),
  mapProfileToUserMock: vi.fn(),
  passkeyPluginMock: vi.fn(),
  postmarkSendEmailMock: vi.fn(),
  prismaAdapterMock: vi.fn(),
  renderMagicLinkEmailMock: vi.fn(),
  renderOrganizationInvitationEmailMock: vi.fn(),
  renderResetPasswordEmailMock: vi.fn(),
  renderVerificationEmailMock: vi.fn(),
  resolveActiveOrganizationIdForSessionMock: vi.fn(),
  sentryCaptureExceptionMock: vi.fn(),
  stripeCreateOrganizationCustomerMock: vi.fn(),
  stripeCreateUserCustomerMock: vi.fn(),
  stripePluginMock: vi.fn(),
  syncSeatsAndCreditsMock: vi.fn(),
  ensureCanAcceptInvitationMock: vi.fn(),
  getMembersByOrganizationIdMock: vi.fn(),
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  getBetterAuthSubscriptionPlansMock: vi.fn(),
  syncUserEmailWithStripeMock: vi.fn(),
  webhookCallAccountCreatedMock: vi.fn(),
  webhookCallUserCreatedMock: vi.fn(),
  webhookCallUserUpdatedMock: vi.fn(),
  workspaceUpsertMock: vi.fn(),
}));

function getDefaultEnv() {
  return {
    BETTER_AUTH_COOKIE_DOMAIN: undefined,
    BETTER_AUTH_EMAIL_VERIFICATION_EXPIRES_IN: 172800,
    BETTER_AUTH_ORG_INVITATION_EXPIRES_IN: 604800,
    BETTER_AUTH_ORG_INVITATION_LIMIT: 100,
    BETTER_AUTH_ORG_LIMIT: 100,
    BETTER_AUTH_PROFILE_PICTURE_TIMEOUT: 10_000,
    BETTER_AUTH_RP_ID: "sokosumi.com",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: 300,
    BETTER_AUTH_STRIPE_WEBHOOK_SECRET: "whsec_better_auth_test",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    MICROSOFT_CLIENT_ID: "microsoft-client-id",
    MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
    NETWORK: "Preprod",
    NODE_ENV: "production",
    PASSWORD_MAX_LENGTH: 256,
    PASSWORD_MIN_LENGTH: 8,
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
  lastLoginMethod: (...args: unknown[]) => lastLoginMethodPluginMock(...args),
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

vi.mock("@better-auth/passkey", () => ({
  passkey: (...args: unknown[]) => passkeyPluginMock(...args),
}));

vi.mock("@better-auth/stripe", () => ({
  stripe: (...args: unknown[]) => stripePluginMock(...args),
}));

vi.mock("@better-auth/i18n", () => ({
  i18n: (...args: unknown[]) => i18nPluginMock(...args),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMembersByOrganizationId: (...args: unknown[]) =>
      getMembersByOrganizationIdMock(...args),
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
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
    createOrganizationCustomer: (...args: unknown[]) =>
      stripeCreateOrganizationCustomerMock(...args),
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

vi.mock("@/helpers/profile-mapper", () => ({
  mapProfileToUser: (...args: unknown[]) => mapProfileToUserMock(...args),
}));

vi.mock("@/services/auth-session.service", () => ({
  authSessionService: {
    resolveActiveOrganizationIdForSession: (...args: unknown[]) =>
      resolveActiveOrganizationIdForSessionMock(...args),
    syncUserEmailWithStripe: (...args: unknown[]) =>
      syncUserEmailWithStripeMock(...args),
  },
}));

vi.mock("@/services/organization-subscription-hooks.service", () => ({
  organizationSubscriptionHooksService: {
    ensureCanAcceptInvitation: (...args: unknown[]) =>
      ensureCanAcceptInvitationMock(...args),
    syncLocalFreeSeatsAndCreditsForCurrentMembers: (...args: unknown[]) =>
      syncSeatsAndCreditsMock(...args),
  },
}));

vi.mock("@/services/stripe-subscription-lifecycle.service", () => ({
  handleSubscriptionDeletedEvent: vi.fn(),
  reconcileActiveStripeBackedSubscription: vi.fn(),
}));

vi.mock("@/services/subscription-catalog.service", () => ({
  getBetterAuthSubscriptionPlans: (...args: unknown[]) =>
    getBetterAuthSubscriptionPlansMock(...args),
}));

vi.mock("@/services/webhook.service", () => ({
  webhookService: {
    callAccountCreated: (...args: unknown[]) =>
      webhookCallAccountCreatedMock(...args),
    callUserCreated: (...args: unknown[]) =>
      webhookCallUserCreatedMock(...args),
    callUserUpdated: (...args: unknown[]) =>
      webhookCallUserUpdatedMock(...args),
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

interface BetterAuthConfig {
  advanced: {
    cookiePrefix?: string;
    crossSubDomainCookies?: {
      domain: string;
      enabled: true;
    };
  };
  databaseHooks: {
    account: {
      create: {
        after: (account: {
          providerId: string;
          userId: string;
        }) => Promise<void>;
      };
    };
    session: {
      create: {
        before: (session: { userId: string }) => Promise<{
          data: Record<string, unknown>;
        }>;
      };
    };
    user: {
      create: {
        before: (user: { email: string; id: string; name: string }) => Promise<{
          data: { email: string; id: string; name: string };
        }>;
        after: (user: {
          email: string;
          id: string;
          name: string;
        }) => Promise<void>;
      };
      update: {
        after: (user: {
          email: string;
          id: string;
          name: string;
        }) => Promise<void>;
      };
    };
  };
  disabledPaths?: string[];
  emailAndPassword: {
    maxPasswordLength: number;
    minPasswordLength: number;
    sendResetPassword: (
      data: { url: string; user: { email: string; name: string } },
      request?: Request,
    ) => Promise<void>;
  };
  emailVerification: {
    autoSignInAfterVerification: boolean;
    expiresIn: number;
    sendOnSignIn: boolean;
    sendOnSignUp: boolean;
    sendVerificationEmail: (
      data: { url: string; user: { email: string; name: string } },
      request?: Request,
    ) => Promise<void>;
  };
  hooks: {
    before: unknown;
    after: unknown;
  };
  plugins: unknown[];
  session: {
    cookieCache?: { enabled: boolean; maxAge: number };
    storeSessionInDatabase?: boolean;
  };
  socialProviders: {
    google: { clientId: string; mapProfileToUser: unknown };
    microsoft: { clientId: string; mapProfileToUser: unknown };
  };
}

function getBetterAuthConfig(): BetterAuthConfig {
  const [[config]] = betterAuthMock.mock.calls as Array<[BetterAuthConfig]>;
  return config;
}

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
    lastLoginMethodPluginMock.mockReturnValue("last-login-method-plugin");
    magicLinkPluginMock.mockReturnValue("magic-link-plugin");
    oAuthProxyPluginMock.mockReturnValue("oauth-proxy-plugin");
    oauthProviderPluginMock.mockReturnValue("oauth-provider-plugin");
    openAPIPluginMock.mockReturnValue("openapi-plugin");
    organizationPluginMock.mockReturnValue("organization-plugin");
    passkeyPluginMock.mockReturnValue("passkey-plugin");
    stripePluginMock.mockReturnValue("stripe-plugin");
    postmarkSendEmailMock.mockResolvedValue({ MessageID: "message_123" });
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    renderMagicLinkEmailMock.mockResolvedValue({
      html: "<html>magic link</html>",
      subject: "Sokosumi - Sign in to your account",
    });
    renderOrganizationInvitationEmailMock.mockResolvedValue({
      html: "<html>invite</html>",
      subject: "Sokosumi - You have been invited",
    });
    renderResetPasswordEmailMock.mockResolvedValue({
      html: "<html>reset</html>",
      subject: "Sokosumi - Reset your password",
    });
    renderVerificationEmailMock.mockResolvedValue({
      html: "<html>verify</html>",
      subject: "Sokosumi - Verify your email",
    });
    resolveActiveOrganizationIdForSessionMock.mockResolvedValue(null);
    sentryCaptureExceptionMock.mockReset();
    stripeCreateOrganizationCustomerMock.mockResolvedValue({ id: "cus_org" });
    stripeCreateUserCustomerMock.mockResolvedValue({ id: "cus_123" });
    workspaceUpsertMock.mockResolvedValue({ id: "workspace_123" });
    betterAuthMock.mockReturnValue({ api: {}, handler: vi.fn() });
    getBetterAuthProductionUrlMock.mockReturnValue("https://example.com/auth");
  });

  it("registers all expected plugins", async () => {
    await import("./auth");

    expect(betterAuthMock).toHaveBeenCalledTimes(1);
    const config = getBetterAuthConfig();

    expect(config.plugins).toEqual(
      expect.arrayContaining([
        "admin-plugin",
        "api-key-plugin",
        "jwt-plugin",
        "magic-link-plugin",
        "passkey-plugin",
        "last-login-method-plugin",
        "oauth-provider-plugin",
        "oauth-proxy-plugin",
        "organization-plugin",
        "i18n-plugin",
        "openapi-plugin",
        "stripe-plugin",
      ]),
    );
  });

  it("does not disable any auth endpoints (web's disabledPaths is dropped: the web facade calls them over HTTP)", async () => {
    await import("./auth");

    expect(getBetterAuthConfig().disabledPaths).toBeUndefined();
  });

  it("enables the session cookie cache with the configured max age", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
    expect(config.session.cookieCache).toEqual({
      enabled: true,
      maxAge: 300,
    });
    expect(config.session.storeSessionInDatabase).toBe(true);
  });

  it("configures Google and Microsoft social providers with the profile mapper", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
    expect(config.socialProviders.google.clientId).toBe("google-client-id");
    expect(config.socialProviders.microsoft.clientId).toBe(
      "microsoft-client-id",
    );
    expect(config.socialProviders.google.mapProfileToUser).toEqual(
      expect.any(Function),
    );
  });

  it("enforces password length limits from env", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
    expect(config.emailAndPassword.minPasswordLength).toBe(8);
    expect(config.emailAndPassword.maxPasswordLength).toBe(256);
  });

  it("configures email verification semantics from web", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
    expect(config.emailVerification.sendOnSignUp).toBe(true);
    expect(config.emailVerification.sendOnSignIn).toBe(true);
    expect(config.emailVerification.autoSignInAfterVerification).toBe(true);
    expect(config.emailVerification.expiresIn).toBe(172800);
  });

  it("configures the passkey plugin with the relying-party id", async () => {
    await import("./auth");

    expect(passkeyPluginMock).toHaveBeenCalledWith({
      rpID: "sokosumi.com",
      rpName: "Sokosumi",
    });
  });

  it("configures the stripe plugin with the dedicated webhook secret and no customer-on-signup", async () => {
    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [
        {
          createCustomerOnSignUp: boolean;
          stripeWebhookSecret: string;
          subscription: { enabled: boolean };
        },
      ]
    >;

    expect(config.stripeWebhookSecret).toBe("whsec_better_auth_test");
    expect(config.createCustomerOnSignUp).toBe(false);
    expect(config.subscription.enabled).toBe(true);
  });

  it("configures the magic link plugin with web's semantics", async () => {
    await import("./auth");

    const [[config]] = magicLinkPluginMock.mock.calls as Array<
      [{ expiresIn: number; storeToken: string; sendMagicLink: unknown }]
    >;

    expect(config.expiresIn).toBe(600);
    expect(config.storeToken).toBe("hashed");
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

  it("disables cross-subdomain cookies when no cookie domain is configured", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      BETTER_AUTH_COOKIE_DOMAIN: undefined,
    });

    await import("./auth");

    const config = getBetterAuthConfig();
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

    const config = getBetterAuthConfig();
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

    expect(getBetterAuthConfig().advanced.cookiePrefix).toBe("sokosumi");
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

    const config = getBetterAuthConfig();
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

    expect(getBetterAuthConfig().advanced.cookiePrefix).toBe(
      "sokosumi-preview-preprod",
    );
  });

  it("resolves the magic-link email locale from the request", async () => {
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

    // pt-BR is unsupported → Accept-Language german wins
    expect(renderMagicLinkEmailMock).toHaveBeenCalledWith({
      locale: "de",
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

  it("sends the reset-password email via Postmark", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
    await config.emailAndPassword.sendResetPassword({
      url: "https://example.com/reset?token=abc",
      user: { email: "jane@example.com", name: "Jane" },
    });

    expect(renderResetPasswordEmailMock).toHaveBeenCalledWith({
      locale: "en",
      name: "Jane",
      resetLink: "https://example.com/reset?token=abc",
    });
    expect(postmarkSendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        To: "jane@example.com",
        Tag: "reset-password",
        MessageStream: "authentications",
      }),
    );
  });

  it("sends the verification email via Postmark", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
    await config.emailVerification.sendVerificationEmail({
      url: "https://example.com/verify?token=abc",
      user: { email: "jane@example.com", name: "Jane" },
    });

    expect(renderVerificationEmailMock).toHaveBeenCalledWith({
      locale: "en",
      name: "Jane",
      verificationLink: "https://example.com/verify?token=abc",
    });
    expect(postmarkSendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        To: "jane@example.com",
        Tag: "verification-email",
        MessageStream: "authentications",
      }),
    );
  });

  it("sets the preferred organization on session create", async () => {
    resolveActiveOrganizationIdForSessionMock.mockResolvedValue("org_42");

    await import("./auth");

    const config = getBetterAuthConfig();
    const result = await config.databaseHooks.session.create.before({
      userId: "user_123",
    });

    expect(result).toEqual({
      data: {
        userId: "user_123",
        activeOrganizationId: "org_42",
      },
    });
  });

  it("keeps the session unchanged when preferred-organization resolution fails", async () => {
    resolveActiveOrganizationIdForSessionMock.mockRejectedValue(
      new Error("db down"),
    );

    await import("./auth");

    const config = getBetterAuthConfig();
    const result = await config.databaseHooks.session.create.before({
      userId: "user_123",
    });

    expect(result).toEqual({ data: { userId: "user_123" } });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: { userId: "user_123" },
      tags: { context: "session_create_preferred_organization" },
    });
  });

  it("calls the account-created webhook from the account hook", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
    await config.databaseHooks.account.create.after({
      providerId: "google",
      userId: "user_123",
    });

    expect(webhookCallAccountCreatedMock).toHaveBeenCalledWith(
      "user_123",
      "google",
    );
  });

  it("calls the user webhooks from the user hooks", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
    const user = {
      email: "jane@example.com",
      id: "user_123",
      name: "Jane",
    };

    await config.databaseHooks.user.create.after(user);
    expect(webhookCallUserCreatedMock).toHaveBeenCalledWith(user);

    await config.databaseHooks.user.update.after(user);
    expect(webhookCallUserUpdatedMock).toHaveBeenCalledWith(user);
  });

  it("stores the email prefix when a new user is created without a name", async () => {
    await import("./auth");

    const config = getBetterAuthConfig();
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

  it("reports workspace creation failures to Sentry without blocking user creation", async () => {
    workspaceUpsertMock.mockRejectedValueOnce(new Error("workspace failed"));

    await import("./auth");

    const config = getBetterAuthConfig();
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
    expect(stripeCreateUserCustomerMock).toHaveBeenCalled();
  });

  it("reports Stripe customer creation failures to Sentry", async () => {
    stripeCreateUserCustomerMock.mockRejectedValueOnce(
      new Error("stripe failed"),
    );

    await import("./auth");

    const config = getBetterAuthConfig();
    await config.databaseHooks.user.create.after({
      email: "andreas@example.com",
      id: "user_123",
      name: "Andreas",
    });
    await Promise.resolve();

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

  it("wires the organization subscription hooks", async () => {
    await import("./auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterAcceptInvitation: (input: {
              organization: { id: string };
            }) => Promise<void>;
            afterAddMember: (input: {
              organization: { id: string };
            }) => Promise<void>;
            beforeAcceptInvitation: (input: {
              organization: { id: string };
            }) => Promise<void>;
          };
          invitationLimit: number;
          organizationLimit: number;
          cancelPendingInvitationsOnReInvite: boolean;
        },
      ]
    >;

    await config.organizationHooks.beforeAcceptInvitation({
      organization: { id: "org_1" },
    });
    expect(ensureCanAcceptInvitationMock).toHaveBeenCalledWith("org_1");

    await config.organizationHooks.afterAcceptInvitation({
      organization: { id: "org_1" },
    });
    await config.organizationHooks.afterAddMember({
      organization: { id: "org_1" },
    });
    expect(syncSeatsAndCreditsMock).toHaveBeenCalledTimes(2);

    expect(config.invitationLimit).toBe(100);
    expect(config.organizationLimit).toBe(100);
    expect(config.cancelPendingInvitationsOnReInvite).toBe(true);
  });

  it("rejects deleting an organization that still has other members", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user_123" },
      { userId: "user_456" },
    ]);

    await import("./auth");

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
        organization: { id: "org_1" },
        user: { id: "user_123" },
      }),
    ).rejects.toMatchObject({
      body: {
        code: "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
      },
    });
  });

  it("links organization invitations to the web app", async () => {
    await import("./auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          sendInvitationEmail: (
            data: {
              email: string;
              id: string;
              inviter: { user: { name: string } };
              organization: { name: string };
            },
            request?: Request,
          ) => Promise<void>;
        },
      ]
    >;

    await config.sendInvitationEmail({
      email: "invitee@example.com",
      id: "inv_123",
      inviter: { user: { name: "Owner" } },
      organization: { name: "Acme" },
    });

    expect(renderOrganizationInvitationEmailMock).toHaveBeenCalledWith({
      invitationLink: "https://example.com/accept-invitation/inv_123",
      invitorUsername: "Owner",
      locale: "en",
      organizationName: "Acme",
    });
    expect(postmarkSendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        To: "invitee@example.com",
        Tag: "invitation-email",
        MessageStream: "organizations",
      }),
    );
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
                slug: string;
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
        slug: "org-one",
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

  it("creates a Stripe customer when an organization is created", async () => {
    await import("./auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterCreateOrganization: (input: {
              organization: {
                id: string;
                metadata?: string | null;
                name: string;
                slug: string;
              };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.afterCreateOrganization({
      organization: {
        id: "org_123",
        metadata: JSON.stringify({ invoiceEmail: "billing@acme.test" }),
        name: "Org One",
        slug: "org-one",
      },
    });
    await Promise.resolve();

    expect(stripeCreateOrganizationCustomerMock).toHaveBeenCalledWith({
      invoiceEmail: "billing@acme.test",
      name: "Org One",
      organizationId: "org_123",
      slug: "org-one",
    });
  });
});
