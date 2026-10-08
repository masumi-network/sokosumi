import { inspect } from "node:util";

import { MemberRole } from "@sokosumi/database";
import { ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE } from "@sokosumi/database/helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface AuthorizeReferenceConfig {
  subscription: {
    authorizeReference: (params: {
      referenceId: string;
      user: { id: string };
      action?: string;
    }) => Promise<boolean>;
  };
}

const {
  adminPluginMock,
  apiKeyPluginMock,
  betterAuthMock,
  getBetterAuthPublicBaseUrlMock,
  getEnvMock,
  getBetterAuthProductionUrlMock,
  getBetterAuthSubscriptionPlansMock,
  getWebAppBaseUrlMock,
  grantSignupBonusCreditsMock,
  hasConsumableEnterpriseContractMock,
  handleSubscriptionDeletedEventMock,
  i18nPluginMock,
  jwtPluginMock,
  lastLoginMethodPluginMock,
  oauthProviderPluginMock,
  getOAuthProviderStateMock,
  oAuthProxyPluginMock,
  openAPIPluginMock,
  emailOTPPluginMock,
  markOutOfCreditsTasksAsToppedUpMock,
  getMemberByUserIdAndOrganizationIdMock,
  passkeyPluginMock,
  sendEmailMock,
  prismaAdapterMock,
  prismaMock,
  prismaTransactionMock,
  prismaUserUpdateManyMock,
  prismaVerificationCreateManyMock,
  reconcileActiveStripeBackedSubscriptionMock,
  renderEmailCodeEmailMock,
  renderVerificationEmailMock,
  resolveActiveOrganizationIdForSessionMock,
  sentryCaptureExceptionMock,
  sentrySetExtrasMock,
  setSessionCookieMock,
  stripeCreateUserCustomerMock,
  stripePluginMock,
  webhookCallAccountCreatedMock,
  webhookCallUserWebhookMock,
  deleteStripeCustomerBestEffortMock,
  deliverOrganizationCalendarInvalidationsNowMock,
  prepareStripeEmailSyncForUserUpdateMock,
  handleUserUpdateStripeEmailSyncMock,
  syncUserEmailWithStripeMock,
  waitUntilCapturedPromises,
  waitUntilMock,
  workspaceUpsertMock,
} = vi.hoisted(() => {
  const waitUntilCapturedPromises: Promise<unknown>[] = [];
  const waitUntilMock = vi.fn((promise: Promise<unknown>) => {
    waitUntilCapturedPromises.push(promise);
  });
  const prismaTransactionMock = vi.fn(
    async (callback: (tx: unknown) => unknown) => callback({}),
  );
  const prismaUserUpdateManyMock = vi.fn();
  const prismaVerificationCreateManyMock = vi.fn();
  const prismaUserFindUniqueMock = vi.fn();
  const prismaOrganizationFindUniqueMock = vi.fn();
  const prismaMemberFindFirstMock = vi.fn();
  const prismaJobFindFirstMock = vi.fn();
  const prismaTaskFindFirstMock = vi.fn();
  const prismaTaskPaymentClaimFindFirstMock = vi.fn();
  const prismaTaskX402PaymentFindFirstMock = vi.fn();
  const prismaSubscriptionFindFirstMock = vi.fn();
  const prismaEnterpriseContractFindFirstMock = vi.fn();
  const prismaMock = {
    __prisma: true,
    $transaction: (callback: (tx: unknown) => unknown) =>
      prismaTransactionMock(callback),
    user: {
      updateMany: prismaUserUpdateManyMock,
      findUnique: prismaUserFindUniqueMock,
    },
    organization: {
      findUnique: prismaOrganizationFindUniqueMock,
    },
    member: {
      findFirst: prismaMemberFindFirstMock,
    },
    job: {
      findFirst: prismaJobFindFirstMock,
    },
    task: {
      findFirst: prismaTaskFindFirstMock,
    },
    taskPaymentClaim: {
      findFirst: prismaTaskPaymentClaimFindFirstMock,
    },
    taskX402Payment: {
      findFirst: prismaTaskX402PaymentFindFirstMock,
    },
    subscription: {
      findFirst: prismaSubscriptionFindFirstMock,
    },
    enterpriseContract: {
      findFirst: prismaEnterpriseContractFindFirstMock,
    },
    verification: {
      createMany: prismaVerificationCreateManyMock,
    },
  };

  return {
    prismaVerificationCreateManyMock,
    adminPluginMock: vi.fn(),
    apiKeyPluginMock: vi.fn(),
    betterAuthMock: vi.fn(),
    getBetterAuthPublicBaseUrlMock: vi.fn(),
    getEnvMock: vi.fn(),
    getBetterAuthProductionUrlMock: vi.fn(),
    getBetterAuthSubscriptionPlansMock: vi.fn(),
    getWebAppBaseUrlMock: vi.fn(),
    grantSignupBonusCreditsMock: vi.fn(),
    hasConsumableEnterpriseContractMock: vi.fn(),
    handleSubscriptionDeletedEventMock: vi.fn(),
    i18nPluginMock: vi.fn(),
    jwtPluginMock: vi.fn(),
    lastLoginMethodPluginMock: vi.fn(),
    oauthProviderPluginMock: vi.fn(),
    getOAuthProviderStateMock: vi.fn(),
    oAuthProxyPluginMock: vi.fn(),
    openAPIPluginMock: vi.fn(),
    emailOTPPluginMock: vi.fn(),
    markOutOfCreditsTasksAsToppedUpMock: vi.fn(),
    getMemberByUserIdAndOrganizationIdMock: vi.fn(),
    passkeyPluginMock: vi.fn(),
    sendEmailMock: vi.fn(),
    prismaAdapterMock: vi.fn(),
    prismaMock,
    prismaTransactionMock,
    prismaUserUpdateManyMock,
    prismaUserFindUniqueMock,
    prismaOrganizationFindUniqueMock,
    reconcileActiveStripeBackedSubscriptionMock: vi.fn(),
    renderEmailCodeEmailMock: vi.fn(),
    renderVerificationEmailMock: vi.fn(),
    resolveActiveOrganizationIdForSessionMock: vi.fn(),
    sentryCaptureExceptionMock: vi.fn(),
    sentrySetExtrasMock: vi.fn(),
    setSessionCookieMock: vi.fn(),
    stripeCreateUserCustomerMock: vi.fn(),
    stripePluginMock: vi.fn(),
    webhookCallAccountCreatedMock: vi.fn(),
    webhookCallUserWebhookMock: vi.fn(),
    deleteStripeCustomerBestEffortMock: vi.fn(),
    deliverOrganizationCalendarInvalidationsNowMock: vi.fn(),
    prepareStripeEmailSyncForUserUpdateMock: vi.fn(),
    handleUserUpdateStripeEmailSyncMock: vi.fn(),
    syncUserEmailWithStripeMock: vi.fn(),
    waitUntilCapturedPromises,
    waitUntilMock,
    workspaceUpsertMock: vi.fn(),
  };
});

async function flushWaitUntil(): Promise<void> {
  await Promise.all(waitUntilCapturedPromises);
}

function getDefaultEnv() {
  return {
    BETTER_AUTH_COOKIE_DOMAIN: undefined,
    BETTER_AUTH_PROFILE_PICTURE_TIMEOUT: 5_000,
    BETTER_AUTH_RP_ID: "example.com",
    BETTER_AUTH_SECRET: "test-secret",
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: 60,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    MICROSOFT_CLIENT_ID: "microsoft-client-id",
    MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
    NETWORK: "Preprod",
    NODE_ENV: "production",
    RESEND_FROM_EMAIL: "no-reply@example.com",
    RESEND_API_KEY: "re_test_key",
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: "whsec_test_123",
    SIGNUP_BONUS_CREDITS: 3000,
    SIGNUP_BONUS_TTL_DAYS: 30,
    VERCEL_ENV: undefined,
    VERCEL_GIT_COMMIT_REF: "",
  };
}

vi.mock("better-auth/cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/cookies")>();
  return {
    ...actual,
    setSessionCookie: (...args: unknown[]) => setSessionCookieMock(...args),
  };
});

vi.mock("better-auth/minimal", () => ({
  betterAuth: (...args: unknown[]) => betterAuthMock(...args),
}));

vi.mock("@better-auth/prisma-adapter", () => ({
  prismaAdapter: (...args: unknown[]) => prismaAdapterMock(...args),
}));

vi.mock("better-auth/plugins", async (importOriginal) => ({
  captcha: (await importOriginal<typeof import("better-auth/plugins")>())
    .captcha,
  admin: (...args: unknown[]) => adminPluginMock(...args),
  jwt: (...args: unknown[]) => jwtPluginMock(...args),
  lastLoginMethod: (...args: unknown[]) => lastLoginMethodPluginMock(...args),
  emailOTP: (...args: unknown[]) => emailOTPPluginMock(...args),
  oAuthProxy: (...args: unknown[]) => oAuthProxyPluginMock(...args),
  openAPI: (...args: unknown[]) => openAPIPluginMock(...args),
}));

// Its hooks are tested in `auth-organization.test.ts`.
vi.mock("./auth-organization", () => ({
  createAuthOrganizationPlugin: () => "organization-plugin",
}));

vi.mock("@better-auth/passkey", () => ({
  passkey: (...args: unknown[]) => passkeyPluginMock(...args),
}));

vi.mock("@better-auth/stripe", () => ({
  stripe: (...args: unknown[]) => stripePluginMock(...args),
}));

vi.mock("@better-auth/api-key", () => ({
  apiKey: (...args: unknown[]) => apiKeyPluginMock(...args),
}));

vi.mock("@better-auth/oauth-provider", () => ({
  oauthProvider: (...args: unknown[]) => oauthProviderPluginMock(...args),
  getOAuthProviderState: () => getOAuthProviderStateMock(),
}));

vi.mock("@better-auth/i18n", () => ({
  i18n: (...args: unknown[]) => i18nPluginMock(...args),
}));

// Keep the real APIError (the hooks throw it and tests assert its shape) but
// reduce createAuthMiddleware to an identity wrapper so the terms guards can be
// invoked directly with a plain context in unit tests. Those run outside a
// request, so there is no social OAuth state to read.
vi.mock("better-auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/api")>();
  return {
    ...actual,
    createAuthMiddleware: (callback: unknown) => callback,
    getOAuthState: async () => null,
  };
});

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
  withScope: (callback: (scope: { setExtras: unknown }) => void) =>
    callback({ setExtras: sentrySetExtrasMock }),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => waitUntilMock(promise),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    grantSignupBonusCredits: (...args: unknown[]) =>
      grantSignupBonusCreditsMock(...args),
    hasConsumableEnterpriseContract: (...args: unknown[]) =>
      hasConsumableEnterpriseContractMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
  workspaceRepository: {
    upsertOrganizationWorkspace: (...args: unknown[]) =>
      workspaceUpsertMock(...args),
  },
}));

vi.mock("@/clients/email.client", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock("@/clients/stripe.client", () => ({
  stripe: { name: "stripe-sdk" },
  stripeClient: {
    createUserCustomer: (...args: unknown[]) =>
      stripeCreateUserCustomerMock(...args),
  },
}));

vi.mock("@/config/env", async (importOriginal) => ({
  getEnv: () => getEnvMock(),
  getBetterAuthProductionUrl: () => getBetterAuthProductionUrlMock(),
  getBetterAuthPublicBaseUrl: () => getBetterAuthPublicBaseUrlMock(),
  getWebAppBaseUrl: () => getWebAppBaseUrlMock(),
  isProductionEnvironment: (
    await importOriginal<typeof import("@/config/env")>()
  ).isProductionEnvironment,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: prismaMock,
}));

vi.mock("@/lib/blob", () => ({
  uploadProfileImage: vi.fn(),
}));

vi.mock("@/services/webhook.service", () => ({
  webhookService: {
    callAccountCreated: (...args: unknown[]) =>
      webhookCallAccountCreatedMock(...args),
    callUserWebhook: (...args: unknown[]) =>
      webhookCallUserWebhookMock(...args),
  },
}));

vi.mock("@/services/subscription-catalog.service", () => ({
  getBetterAuthSubscriptionPlans: (...args: unknown[]) =>
    getBetterAuthSubscriptionPlansMock(...args),
}));

vi.mock("@/services/task-topup.service", () => ({
  markOutOfCreditsTasksAsToppedUp: (...args: unknown[]) =>
    markOutOfCreditsTasksAsToppedUpMock(...args),
}));

vi.mock("@/services/stripe-backed-subscription.service", () => ({
  handleSubscriptionDeletedEvent: (...args: unknown[]) =>
    handleSubscriptionDeletedEventMock(...args),
  reconcileActiveStripeBackedSubscription: (...args: unknown[]) =>
    reconcileActiveStripeBackedSubscriptionMock(...args),
}));

vi.mock("@/services/preferred-organization.service", () => ({
  resolveActiveOrganizationIdForSession: (...args: unknown[]) =>
    resolveActiveOrganizationIdForSessionMock(...args),
}));

vi.mock("@/helpers/stripe-customer-delete", () => ({
  deleteStripeCustomerBestEffort: (...args: unknown[]) =>
    deleteStripeCustomerBestEffortMock(...args),
}));

vi.mock("@/helpers/calendar-invalidation", () => ({
  deliverOrganizationCalendarInvalidationsNow: (...args: unknown[]) =>
    deliverOrganizationCalendarInvalidationsNowMock(...args),
}));

vi.mock("@/services/stripe-user-email.service", () => ({
  prepareStripeEmailSyncForUserUpdate: (...args: unknown[]) =>
    prepareStripeEmailSyncForUserUpdateMock(...args),
  handleUserUpdateStripeEmailSync: (...args: unknown[]) =>
    handleUserUpdateStripeEmailSyncMock(...args),
  syncUserEmailWithStripe: (...args: unknown[]) =>
    syncUserEmailWithStripeMock(...args),
}));

vi.mock("@/helpers/design-md-metadata-auth", () => ({
  applyDesignMdMetadataGuardToUserCreate: (user: Record<string, unknown>) =>
    user,
  applyDesignMdMetadataGuardToUserUpdate: async (
    updateData: Record<string, unknown>,
  ) => updateData,
  applyDesignMdMetadataGuardToOrganizationCreate: (
    organization: Record<string, unknown>,
  ) => organization,
  applyDesignMdMetadataGuardToOrganizationUpdate: async (
    organization: Record<string, unknown>,
  ) => organization,
}));

vi.mock("@sokosumi/email", () => ({
  renderEmailCodeEmail: (...args: unknown[]) =>
    renderEmailCodeEmailMock(...args),
  renderVerificationEmail: (...args: unknown[]) =>
    renderVerificationEmailMock(...args),
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
    getWebAppBaseUrlMock.mockReturnValue("https://preprod.sokosumi.com");
    jwtPluginMock.mockReturnValue("jwt-plugin");
    lastLoginMethodPluginMock.mockReturnValue("last-login-method-plugin");
    emailOTPPluginMock.mockReturnValue({
      id: "email-otp",
      endpoints: {
        signInEmailOTP: {
          path: "/sign-in/email-otp",
          options: { method: "POST" },
        },
      },
      hooks: { after: [] },
    });
    oAuthProxyPluginMock.mockReturnValue("oauth-proxy-plugin");
    oauthProviderPluginMock.mockReturnValue("oauth-provider-plugin");
    openAPIPluginMock.mockReturnValue("openapi-plugin");
    passkeyPluginMock.mockReturnValue("passkey-plugin");
    reconcileActiveStripeBackedSubscriptionMock.mockResolvedValue(undefined);
    sendEmailMock.mockResolvedValue({ id: "email_123" });
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    getOAuthProviderStateMock.mockResolvedValue(null);
    renderVerificationEmailMock.mockResolvedValue({
      html: "<html>verification</html>",
      subject: "Sokosumi - Verify your email address",
    });
    renderEmailCodeEmailMock.mockResolvedValue({
      html: "<html>email code</html>",
      subject: "Your Sokosumi code: 042917",
    });
    sentryCaptureExceptionMock.mockReset();
    stripeCreateUserCustomerMock.mockResolvedValue({ id: "cus_123" });
    webhookCallAccountCreatedMock.mockResolvedValue(undefined);
    webhookCallUserWebhookMock.mockResolvedValue(undefined);
    stripePluginMock.mockReturnValue("stripe-plugin");
    workspaceUpsertMock.mockResolvedValue({ id: "workspace_123" });
    prismaMock.user.findUnique.mockResolvedValue({ stripeCustomerId: null });
    prismaMock.organization.findUnique.mockResolvedValue({
      stripeCustomerId: null,
    });
    prismaMock.member.findFirst.mockResolvedValue(null);
    prismaMock.job.findFirst.mockResolvedValue(null);
    prismaMock.task.findFirst.mockResolvedValue(null);
    prismaMock.taskPaymentClaim.findFirst.mockResolvedValue(null);
    prismaMock.taskX402Payment.findFirst.mockResolvedValue(null);
    prismaMock.subscription.findFirst.mockResolvedValue(null);
    prismaMock.enterpriseContract.findFirst.mockResolvedValue(null);
    deleteStripeCustomerBestEffortMock.mockResolvedValue(undefined);
    prismaTransactionMock.mockImplementation(async (callback) =>
      callback({
        user: {
          findUnique: vi.fn().mockResolvedValue({
            preferredOrganizationId: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
      }),
    );
    betterAuthMock.mockReturnValue({ api: {}, handler: vi.fn() });
    getBetterAuthProductionUrlMock.mockReturnValue("https://example.com/auth");
    getBetterAuthSubscriptionPlansMock.mockResolvedValue([]);
    hasConsumableEnterpriseContractMock.mockResolvedValue(false);
    handleSubscriptionDeletedEventMock.mockResolvedValue(undefined);
    prepareStripeEmailSyncForUserUpdateMock.mockResolvedValue(undefined);
    handleUserUpdateStripeEmailSyncMock.mockResolvedValue(undefined);
    syncUserEmailWithStripeMock.mockResolvedValue(undefined);
    grantSignupBonusCreditsMock.mockResolvedValue({ created: true });
    waitUntilCapturedPromises.length = 0;
    waitUntilMock.mockClear();
  });

  it("fires account-created webhook when a social account is linked", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            account: {
              create: {
                after: (account: {
                  userId: string;
                  providerId: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await config.databaseHooks.account.create.after({
      userId: "user_123",
      providerId: "google",
    });

    expect(prismaUserUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "user_123", emailVerified: false },
      data: { emailVerified: true },
    });
    expect(webhookCallAccountCreatedMock).toHaveBeenCalledWith(
      "user_123",
      "google",
    );
  });

  it("marks email verified when a Microsoft account is linked", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            account: {
              create: {
                after: (account: {
                  userId: string;
                  providerId: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await config.databaseHooks.account.create.after({
      userId: "user_456",
      providerId: "microsoft",
    });

    expect(prismaUserUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "user_456", emailVerified: false },
      data: { emailVerified: true },
    });
  });

  it("does not mark email verified when a credential account is created", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            account: {
              create: {
                after: (account: {
                  userId: string;
                  providerId: string;
                }) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await config.databaseHooks.account.create.after({
      userId: "user_789",
      providerId: "credential",
    });

    expect(prismaUserUpdateManyMock).not.toHaveBeenCalled();
    expect(webhookCallAccountCreatedMock).toHaveBeenCalledWith(
      "user_789",
      "credential",
    );
  });

  it("configures lastLoginMethod with the computed cookie name", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      NETWORK: "Mainnet",
      VERCEL_ENV: "production",
    });

    await import("./auth");

    expect(lastLoginMethodPluginMock).toHaveBeenCalledWith({
      cookieName: "sokosumi.last_used_login_method",
      customResolveMethod: expect.any(Function),
    });
    // A password sign-up goes through the email code, and is still `email`.
    const [[options]] = lastLoginMethodPluginMock.mock.calls as Array<
      [{ customResolveMethod: (ctx: unknown) => string | null }]
    >;
    expect(
      options.customResolveMethod({
        path: "/sign-in/email-otp",
        body: { password: "Password123!" },
      }),
    ).toBe("email");
  });

  it("configures subscription checkout for billing, tax IDs, and customer updates", async () => {
    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [
        {
          stripeWebhookSecret: string;
          subscription: {
            getCheckoutSessionParams: () => Promise<{
              params?: {
                automatic_tax?: {
                  enabled: boolean;
                };
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

    expect(config.stripeWebhookSecret).toBe("whsec_test_123");

    const sessionParams = await config.subscription.getCheckoutSessionParams();

    expect(sessionParams).toEqual({
      params: {
        automatic_tax: {
          enabled: true,
        },
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
    await import("./auth");

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

  interface SubscriptionHookConfig {
    subscription: {
      onSubscriptionCreated?: unknown;
      onSubscriptionUpdate: (params: {
        event: { id: string; type: string };
        subscription: {
          id: string;
          referenceId: string;
          stripeSubscriptionId?: string | null;
        };
      }) => Promise<void>;
    };
  }

  const updatedSubscription = {
    id: "sub_local_enterprise",
    referenceId: "org-enterprise",
    stripeSubscriptionId: "sub_enterprise",
  };

  const updatedEvent = {
    id: "evt_enterprise",
    type: "customer.subscription.updated",
  };

  it("leaves customer.subscription.created to onEvent, where a failure is retried", async () => {
    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [SubscriptionHookConfig]
    >;

    expect(config.subscription.onSubscriptionCreated).toBeUndefined();
  });

  it("reconciles on a subscription update without auto-assigning seats", async () => {
    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [SubscriptionHookConfig]
    >;

    await config.subscription.onSubscriptionUpdate({
      event: updatedEvent,
      subscription: updatedSubscription,
    });

    // The exact call, so an auto-assign option cannot slip in.
    expect(reconcileActiveStripeBackedSubscriptionMock.mock.calls).toEqual([
      [updatedSubscription],
    ]);
  });

  it("reports a failed update reconciliation without throwing", async () => {
    const failure = new Error("reconcile failed");
    reconcileActiveStripeBackedSubscriptionMock.mockRejectedValueOnce(failure);
    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [SubscriptionHookConfig]
    >;

    await expect(
      config.subscription.onSubscriptionUpdate({
        event: updatedEvent,
        subscription: updatedSubscription,
      }),
    ).resolves.toBeUndefined();

    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({
          stripeEventType: "customer.subscription.updated",
          stripeSubscriptionId: "sub_enterprise",
        }),
        extra: {
          eventId: "evt_enterprise",
          localSubscriptionId: "sub_local_enterprise",
          referenceId: "org-enterprise",
        },
      }),
    );
  });

  it("denies subscription management for non-members", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);

    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [AuthorizeReferenceConfig]
    >;

    await expect(
      config.subscription.authorizeReference({
        referenceId: "org_123",
        user: { id: "user_123" },
        action: "upgrade-subscription",
      }),
    ).resolves.toBe(false);

    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      prismaMock,
    );
    expect(hasConsumableEnterpriseContractMock).not.toHaveBeenCalled();
  });

  it("denies subscription management for members without owner or admin role", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      role: MemberRole.MEMBER,
    });

    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [AuthorizeReferenceConfig]
    >;

    await expect(
      config.subscription.authorizeReference({
        referenceId: "org_123",
        user: { id: "user_123" },
        action: "upgrade-subscription",
      }),
    ).resolves.toBe(false);
    expect(hasConsumableEnterpriseContractMock).not.toHaveBeenCalled();
  });

  it.each([MemberRole.OWNER, MemberRole.ADMIN] as const)(
    "allows subscription management for %s without an enterprise contract",
    async (role) => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role });
      hasConsumableEnterpriseContractMock.mockResolvedValue(false);

      await import("./auth");

      const [[config]] = stripePluginMock.mock.calls as Array<
        [AuthorizeReferenceConfig]
      >;

      await expect(
        config.subscription.authorizeReference({
          referenceId: "org_123",
          user: { id: "user_123" },
          action: "upgrade-subscription",
        }),
      ).resolves.toBe(true);

      expect(hasConsumableEnterpriseContractMock).toHaveBeenCalledWith(
        "org_123",
        prismaMock,
      );
    },
  );

  it("throws enterprise exclusivity error when upgrading an org with a consumable enterprise contract", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    hasConsumableEnterpriseContractMock.mockResolvedValue(true);

    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [AuthorizeReferenceConfig]
    >;

    await expect(
      config.subscription.authorizeReference({
        referenceId: "org_123",
        user: { id: "user_123" },
        action: "upgrade-subscription",
      }),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: {
        code: "ORGANIZATION_ENTERPRISE_CONTRACT_EXCLUSIVE",
        message: ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE,
      },
    });
  });

  it("allows non-upgrade actions even with a consumable enterprise contract", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      role: MemberRole.OWNER,
    });
    hasConsumableEnterpriseContractMock.mockResolvedValue(true);

    await import("./auth");

    const [[config]] = stripePluginMock.mock.calls as Array<
      [AuthorizeReferenceConfig]
    >;

    await expect(
      config.subscription.authorizeReference({
        referenceId: "org_123",
        user: { id: "user_123" },
        action: "cancel-subscription",
      }),
    ).resolves.toBe(true);
    expect(hasConsumableEnterpriseContractMock).not.toHaveBeenCalled();
  });

  it("keeps a session fresh for fifteen minutes", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ session: { freshAge: number } }]
    >;

    // Better Auth defaults to 24 hours. Passkey registration and account
    // unlinking read this value, so a day-old session must not pass.
    expect(config.session.freshAge).toBe(15 * 60);
  });

  it("uses basePath /auth and registers core auth plugins", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          basePath: string;
          plugins: unknown[];
        },
      ]
    >;

    expect(config.basePath).toBe("/auth");
    expect(prismaAdapterMock).toHaveBeenCalledWith(expect.anything(), {
      provider: "postgresql",
      transaction: true,
    });
    expect(config.plugins).toEqual(
      expect.arrayContaining([
        "admin-plugin",
        "api-key-plugin",
        "jwt-plugin",
        "i18n-plugin",
        "openapi-plugin",
        "organization-plugin",
        "passkey-plugin",
        "last-login-method-plugin",
        "oauth-provider-plugin",
        "oauth-proxy-plugin",
        "stripe-plugin",
        expect.objectContaining({ id: "email-code-sign-in" }),
      ]),
    );
    expect(apiKeyPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        configId: "default",
        references: "user",
        enableMetadata: true,
        // A key authenticates a request. It must never mint a session, because
        // that session is fresh enough to register a passkey.
        enableSessionForAPIKeys: false,
      }),
    );
    expect(jwtPluginMock).toHaveBeenCalledWith({
      disableSettingJwtHeader: true,
    });
  });

  it("passes the API key rate limit window to the plugin in milliseconds", async () => {
    await import("./auth");

    const [[apiKeyConfig]] = apiKeyPluginMock.mock.calls as Array<
      [
        {
          rateLimit: {
            enabled: boolean;
            timeWindow: number;
            maxRequests: number;
          };
        },
      ]
    >;

    // The plugin counts requests per timeWindow in milliseconds, while
    // TIME.RATE_LIMIT_WINDOW is a seconds value: 100 requests per 60 s.
    expect(apiKeyConfig.rateLimit).toEqual({
      enabled: true,
      timeWindow: 60_000,
      maxRequests: 100,
    });
  });

  it("keeps branch previews out of production trustedOrigins", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      NODE_ENV: "production",
      VERCEL_ENV: "production",
    });

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ trustedOrigins: string[] }]
    >;

    expect(config.trustedOrigins).toEqual([
      "https://app.sokosumi.com",
      "https://preprod.sokosumi.com",
    ]);
  });

  it("allows localhost trustedOrigins in development only", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      NODE_ENV: "development",
    });

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ trustedOrigins: string[] }]
    >;

    expect(config.trustedOrigins).toEqual([
      "https://app.sokosumi.com",
      "https://preprod.sokosumi.com",
      "http://localhost:*",
      "https://localhost:*",
      "http://*.localhost:*",
      "https://*.localhost",
      "https://*.localhost:*",
    ]);
  });

  it("trusts the exact related web preview origin for Better Auth", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "fix/web-preview-core-url",
    });
    getWebAppBaseUrlMock.mockReturnValue(
      "https://sokosumi-app-preprod-git-fix-web-preview-core-url.preview.sokosumi.com",
    );

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ trustedOrigins: string[] }]
    >;

    expect(config.trustedOrigins).toEqual([
      "https://app.sokosumi.com",
      "https://preprod.sokosumi.com",
      "https://sokosumi-app-preprod-git-fix-web-preview-core-url.preview.sokosumi.com",
      "https://*.preview.sokosumi.com",
    ]);
  });

  it("sends sign-in errors without a callback to the related web preview's error page", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "fix/web-preview-core-url",
    });
    getWebAppBaseUrlMock.mockReturnValue(
      "https://sokosumi-app-preprod-git-fix-web-preview-core-url.preview.sokosumi.com",
    );

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ onAPIError: { errorURL: string } }]
    >;

    expect(config.onAPIError.errorURL).toBe(
      "https://sokosumi-app-preprod-git-fix-web-preview-core-url.preview.sokosumi.com/auth/error",
    );
  });

  it("uses uuid database ids and database-backed rate limits", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          advanced: {
            database: {
              generateId: string;
              joins?: boolean;
            };
          };
          experimental?: {
            joins: boolean;
          };
          rateLimit: {
            storage: string;
          };
        },
      ]
    >;

    expect(config.advanced.database.generateId).toBe("uuid");
    expect(config.advanced.database.joins).toBe(true);
    expect(config.experimental).toBeUndefined();
    expect(config.rateLimit.storage).toBe("database");
  });

  it("defines user additional fields for auth parity", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          user: {
            additionalFields: Record<
              string,
              {
                type: string;
                required?: boolean;
                defaultValue?: unknown;
                input?: boolean;
              }
            >;
          };
        },
      ]
    >;

    expect(Object.keys(config.user.additionalFields)).toEqual(
      expect.arrayContaining([
        "termsAccepted",
        "marketingOptIn",
        "logo",
        "metadata",
        "stripeCustomerId",
      ]),
    );
    expect(Object.keys(config.user.additionalFields)).not.toContain(
      "onboardingCompleted",
    );
    // The job status emails went in SOK-930 and left this switch with no
    // reader, so SOK-934 stopped the session carrying it.
    expect(Object.keys(config.user.additionalFields)).not.toContain(
      "notificationsOptIn",
    );
    expect(config.user.additionalFields.stripeCustomerId).toEqual({
      type: "string",
      required: false,
      defaultValue: null,
      input: false,
    });
  });

  it("signs in with a six-digit email code that lasts ten minutes, allows five tries and survives a resend", async () => {
    await import("./auth");

    expect(emailOTPPluginMock).toHaveBeenCalledTimes(1);
    expect(emailOTPPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        // A resend repeats the code, so a late first email still works.
        storeOTP: "encrypted",
        resendStrategy: "reuse",
        disableSignUp: false,
      }),
    );
  });

  // Better Auth keys the bucket by IP and path, and this plugin rule overrides
  // its default three a minute for sending.
  it("asks the email code plugin for ten requests a minute, so a shared office network still signs in", async () => {
    await import("./auth");

    expect(emailOTPPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimit: { window: 60, max: 10 } }),
    );
  });

  it("closes the email code endpoints Sokosumi does not use", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ disabledPaths: string[] }]
    >;

    expect(config.disabledPaths).toEqual(
      expect.arrayContaining([
        "/email-otp/check-verification-otp",
        "/email-otp/verify-email",
        "/email-otp/request-password-reset",
        "/forget-password/email-otp",
        "/email-otp/reset-password",
        "/email-otp/request-email-change",
        "/email-otp/change-email",
      ]),
    );
    expect(config.disabledPaths).not.toContain("/sign-in/email-otp");
    expect(config.disabledPaths).not.toContain(
      "/email-otp/send-verification-otp",
    );
  });

  // Password sign-up sends the password with the email code instead, so no
  // new account starts with an unproven address.
  it("closes password sign-up without an email code", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ disabledPaths: string[] }]
    >;

    expect(config.disabledPaths).toContain("/sign-up/email");
  });

  it("uses the canonical production URL for the OAuth proxy", async () => {
    getBetterAuthProductionUrlMock.mockReturnValue(
      "https://canonical.example.com",
    );

    await import("./auth");

    expect(oAuthProxyPluginMock).toHaveBeenCalledWith({
      productionURL: "https://canonical.example.com",
      currentURL: "https://example.com/auth",
    });
  });

  it("tells the OAuth proxy its own URL instead of leaving it to the request", async () => {
    getBetterAuthPublicBaseUrlMock.mockReturnValue(
      "https://core-pr.preview.example.com",
    );

    await import("./auth");

    expect(oAuthProxyPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        currentURL: "https://core-pr.preview.example.com",
      }),
    );
  });

  it("encrypts the OAuth proxy hand-off with its own secret", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      OAUTH_PROXY_SECRET: "proxy-secret",
    });

    await import("./auth");

    expect(oAuthProxyPluginMock).toHaveBeenCalledWith({
      productionURL: "https://example.com/auth",
      currentURL: "https://example.com/auth",
      secret: "proxy-secret",
    });
  });

  it("revokes every existing session when a password is reset", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          emailAndPassword: {
            revokeSessionsOnPasswordReset?: boolean;
          };
        },
      ]
    >;

    expect(config.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
  });

  describe("app tokens", () => {
    const now = new Date("2026-10-02T12:00:00Z");
    const updateMany = vi.fn();

    function expectAppTokensRevokedFor(userId: string) {
      const where = [
        { field: "userId", value: userId },
        { field: "revoked", operator: "eq", value: null },
      ];
      expect(updateMany).toHaveBeenCalledTimes(2);
      expect(updateMany).toHaveBeenCalledWith({
        model: "oauthAccessToken",
        where,
        update: { revoked: now },
      });
      expect(updateMany).toHaveBeenCalledWith({
        model: "oauthRefreshToken",
        where,
        update: { revoked: now },
      });
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now });
      updateMany.mockReset();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("revokes every app token when a password is reset", async () => {
      betterAuthMock.mockReturnValue({
        api: {},
        handler: vi.fn(),
        $context: Promise.resolve({
          adapter: { updateMany },
          internalAdapter: { deleteUserSessions: vi.fn() },
        }),
      });
      await import("./auth");

      const [[config]] = betterAuthMock.mock.calls as Array<
        [
          {
            emailAndPassword: {
              onPasswordReset: (data: {
                user: { id: string };
              }) => Promise<void>;
            };
          },
        ]
      >;

      await config.emailAndPassword.onPasswordReset({ user: { id: "user-1" } });

      expectAppTokensRevokedFor("user-1");
    });

    it("ends every session on a reset even when revoking app tokens fails", async () => {
      // Better Auth deletes sessions only after this callback returns.
      const deleteUserSessions = vi.fn();
      updateMany.mockRejectedValue(new Error("database gone"));
      betterAuthMock.mockReturnValue({
        api: {},
        handler: vi.fn(),
        $context: Promise.resolve({
          adapter: { updateMany },
          internalAdapter: { deleteUserSessions },
        }),
      });
      await import("./auth");

      const [[config]] = betterAuthMock.mock.calls as Array<
        [
          {
            emailAndPassword: {
              onPasswordReset: (data: {
                user: { id: string };
              }) => Promise<void>;
            };
          },
        ]
      >;

      await expect(
        config.emailAndPassword.onPasswordReset({ user: { id: "user-1" } }),
      ).rejects.toThrow("database gone");
      expect(deleteUserSessions).toHaveBeenCalledWith("user-1");
    });

    async function runAfterHook(ctx: {
      path: string;
      body?: Record<string, unknown>;
      returned: unknown;
    }) {
      await import("./auth");

      const [[config]] = betterAuthMock.mock.calls as Array<
        [{ hooks: { after: (ctx: unknown) => Promise<void> } }]
      >;

      await config.hooks.after({
        path: ctx.path,
        body: ctx.body,
        context: {
          adapter: { updateMany },
          returned: ctx.returned,
          session: { user: { id: "user-1" } },
        },
      });
    }

    it.each([true, false])(
      "revokes every app token when a password is changed (revokeOtherSessions: %s)",
      async (revokeOtherSessions) => {
        await runAfterHook({
          path: "/change-password",
          body: { revokeOtherSessions },
          returned: { token: null, user: { id: "user-1" } },
        });

        expectAppTokensRevokedFor("user-1");
      },
    );

    it.each(["/revoke-sessions", "/revoke-other-sessions"])(
      "revokes every app token on %s",
      async (path) => {
        await runAfterHook({ path, returned: { status: true } });

        expectAppTokensRevokedFor("user-1");
      },
    );

    it("keeps app tokens when the person signs out of Sokosumi", async () => {
      await runAfterHook({ path: "/sign-out", returned: { success: true } });

      expect(updateMany).not.toHaveBeenCalled();
    });

    it("keeps app tokens when the current password is wrong", async () => {
      const { APIError } = await import("better-auth/api");

      await runAfterHook({
        path: "/change-password",
        body: { revokeOtherSessions: true },
        returned: new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD" }),
      });

      expect(updateMany).not.toHaveBeenCalled();
    });
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

  it("emails the code in the reader's language", async () => {
    await import("./auth");

    const [[config]] = emailOTPPluginMock.mock.calls as Array<
      [
        {
          sendVerificationOTP: (
            data: { email: string; otp: string; type: string },
            ctx?: { headers?: Headers; request?: Request },
          ) => Promise<void>;
        },
      ]
    >;

    const request = new Request(
      "https://example.com/auth/email-otp/send-verification-otp",
      {
        headers: {
          "accept-language": "de-DE,de;q=0.9",
          cookie: "sokosumi.locale=pt-BR",
        },
      },
    );

    await config.sendVerificationOTP(
      { email: "andreas@example.com", otp: "042917", type: "sign-in" },
      {
        headers: new Headers({ cookie: "sokosumi.locale=pt-BR" }),
        request,
      },
    );

    expect(renderEmailCodeEmailMock).toHaveBeenCalledWith({
      locale: "de",
      code: "042917",
      expiresInMinutes: 10,
    });
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: "andreas@example.com",
      tag: "email-code",
      subject: "Your Sokosumi code: 042917",
      html: "<html>email code</html>",
    });
  });

  // Local Core has no working email key, so the console is the inbox.
  describe("email code in the console", () => {
    async function sendCode() {
      await import("./auth");
      const [[config]] = emailOTPPluginMock.mock.calls as Array<
        [
          {
            sendVerificationOTP: (data: {
              email: string;
              otp: string;
              type: string;
            }) => Promise<void>;
          },
        ]
      >;
      await config.sendVerificationOTP({
        email: "andreas@example.com",
        otp: "042917",
        type: "sign-in",
      });
    }

    async function expectCodeLine(printed: boolean) {
      const write = vi
        .spyOn(process.stdout, "write")
        .mockImplementation(() => true);

      try {
        await sendCode();

        if (printed) {
          expect(write).toHaveBeenCalledWith(
            "[email code] andreas@example.com: 042917\n",
          );
        } else {
          expect(write).not.toHaveBeenCalledWith(
            expect.stringContaining("042917"),
          );
        }
        expect(sendEmailMock).toHaveBeenCalledOnce();
      } finally {
        write.mockRestore();
      }
    }

    it("prints the code in development, and still emails it", async () => {
      getEnvMock.mockReturnValue({
        ...getDefaultEnv(),
        NODE_ENV: "development",
      });

      await expectCodeLine(true);
    });

    it("keeps the development code usable when email delivery fails", async () => {
      getEnvMock.mockReturnValue({
        ...getDefaultEnv(),
        NODE_ENV: "development",
      });
      const failure = Object.assign(new Error("Email transport unavailable"), {
        name: "application_error",
        statusCode: null,
      });
      sendEmailMock.mockRejectedValueOnce(failure);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        await expectCodeLine(true);
        await expect(flushWaitUntil()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith(
          "[email_code_email] suppressed external failure",
          {
            error: "Email code delivery failed",
          },
        );
        expect(JSON.stringify(warn.mock.calls)).not.toContain("042917");
        expect(JSON.stringify(warn.mock.calls)).not.toContain(
          "andreas@example.com",
        );
      } finally {
        warn.mockRestore();
      }
    });

    it.each(["production", "staging"])(
      "never prints it when NODE_ENV is %s, and still emails it",
      async (nodeEnv) => {
        getEnvMock.mockReturnValue({
          ...getDefaultEnv(),
          NODE_ENV: nodeEnv,
        });

        await expectCodeLine(false);
      },
    );

    it("reports a failed send to Sentry without the address", async () => {
      const failure = new Error("Resend rejected the request");
      sendEmailMock.mockRejectedValueOnce(failure);

      await sendCode();
      await flushWaitUntil();

      expect(sentryCaptureExceptionMock).toHaveBeenCalledOnce();
      expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Email code delivery failed" }),
        { tags: { context: "email_code_email" } },
      );
      expect(
        JSON.stringify(sentryCaptureExceptionMock.mock.calls),
      ).not.toContain("andreas@example.com");
    });
  });

  it.each([422, 503])(
    "keeps recipient-bearing provider errors out of telemetry (%s)",
    async (statusCode) => {
      const failure = Object.assign(
        new Error("Unable to send to andreas@example.com: 042917"),
        {
          name: "application_error",
          statusCode,
          cause: { message: "andreas@example.com", code: "042917" },
        },
      );
      sendEmailMock.mockRejectedValueOnce(failure);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await import("./auth");

      const [[config]] = emailOTPPluginMock.mock.calls as Array<
        [
          {
            sendVerificationOTP: (data: {
              email: string;
              otp: string;
              type: string;
            }) => Promise<void>;
          },
        ]
      >;

      await config.sendVerificationOTP({
        email: "andreas@example.com",
        otp: "042917",
        type: "sign-in",
      });
      await flushWaitUntil();

      expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(
        statusCode === 503 ? 0 : 1,
      );
      expect(warn).toHaveBeenCalledTimes(statusCode === 503 ? 1 : 0);
      const reported = inspect(
        [
          sentryCaptureExceptionMock.mock.calls,
          sentrySetExtrasMock.mock.calls,
          warn.mock.calls,
        ],
        { depth: null },
      );
      expect(reported).not.toContain("andreas@example.com");
      expect(reported).not.toContain("042917");
      expect(reported).toContain("Email code delivery failed");
      warn.mockRestore();
    },
  );

  describe("verification email", () => {
    type SendVerificationEmail = (
      data: { user: { id: string; email: string; name: string }; url: string },
      request?: Request,
    ) => Promise<void>;

    const VERIFY_URL =
      "https://example.com/auth/verify-email?token=abc&callbackURL=%2F";
    const user = { id: "user_1", email: "ada@example.com", name: "Ada" };

    async function sendVerificationEmail(): Promise<void> {
      await import("./auth");
      const [[config]] = betterAuthMock.mock.calls as Array<
        [
          {
            emailVerification: { sendVerificationEmail: SendVerificationEmail };
          },
        ]
      >;
      await config.emailVerification.sendVerificationEmail(
        { user, url: VERIFY_URL },
        new Request("https://example.com/auth/send-verification-email", {
          headers: { "accept-language": "en" },
        }),
      );
      await flushWaitUntil();
    }

    function renderedLinkCallback(): string | null {
      const [[props]] = renderVerificationEmailMock.mock.calls as Array<
        [{ verificationLink: string }]
      >;
      return new URL(props.verificationLink).searchParams.get("callbackURL");
    }

    it("sends Sokosumi's email with the link anchored to the web app", async () => {
      await sendVerificationEmail();

      expect(renderVerificationEmailMock).toHaveBeenCalledWith({
        locale: "en",
        name: "Ada",
        verificationLink: expect.any(String),
      });
      expect(renderedLinkCallback()).toBe("https://preprod.sokosumi.com/");
      expect(sendEmailMock).toHaveBeenCalledWith({
        to: "ada@example.com",
        tag: "verification-email",
        subject: "Sokosumi - Verify your email address",
        html: "<html>verification</html>",
      });
    });
  });

  it("stores a blank name when a new user is created without one", async () => {
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
        name: "",
      },
    });

    await config.databaseHooks.user.create.after(normalizedCreate.data);

    expect(workspaceUpsertMock).not.toHaveBeenCalled();
    expect(waitUntilMock).toHaveBeenCalledTimes(3);
    await flushWaitUntil();
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith({
      email: " magic@example.com ",
      name: "",
      userId: "user_123",
    });
    expect(prismaTransactionMock).toHaveBeenCalled();
    expect(grantSignupBonusCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credits: 3000,
        userId: "user_123",
      }),
      expect.anything(),
    );
    expect(markOutOfCreditsTasksAsToppedUpMock).toHaveBeenCalledWith({
      organizationId: null,
      tx: expect.anything(),
      userId: "user_123",
    });
  });

  it("does not invent a name from the email when signup omits one", async () => {
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
        name: "",
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

    expect(workspaceUpsertMock).not.toHaveBeenCalled();
    expect(waitUntilMock).toHaveBeenCalledTimes(3);
    await flushWaitUntil();
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith({
      email: "andreas@example.com",
      name: "Andreas",
      userId: "user_123",
    });
    expect(grantSignupBonusCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credits: 3000,
        userId: "user_123",
      }),
      expect.anything(),
    );
  });

  it("records a social sign-up before the provider callback answers", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                after: (
                  user: { email: string; id: string; name: string },
                  ctx: { path: string; params: Record<string, string> },
                ) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await config.databaseHooks.user.create.after(
      { email: "andreas@example.com", id: "user_123", name: "Andreas" },
      { path: "/callback/:id", params: { id: "google" } },
    );

    expect(prismaVerificationCreateManyMock).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          identifier: "sign-up-conversion:user_123",
          value: "google",
        }),
      ]),
    });
  });

  it("reports a failed social sign-up record to Sentry without blocking the sign-up", async () => {
    prismaVerificationCreateManyMock.mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              create: {
                after: (
                  user: { email: string; id: string; name: string },
                  ctx: { path: string; params: Record<string, string> },
                ) => Promise<void>;
              };
            };
          };
        },
      ]
    >;

    await expect(
      config.databaseHooks.user.create.after(
        { email: "andreas@example.com", id: "user_123", name: "Andreas" },
        { path: "/callback/:id", params: { id: "microsoft" } },
      ),
    ).resolves.toBeUndefined();
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { context: "sign_up_conversion" },
      }),
    );
  });

  it("registers signup side effects with waitUntil without awaiting them in the after hook", async () => {
    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    prismaTransactionMock.mockImplementation(async (callback) => {
      await transactionGate;
      return callback({});
    });

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

    expect(waitUntilMock).toHaveBeenCalledTimes(3);
    expect(grantSignupBonusCreditsMock).not.toHaveBeenCalled();

    releaseTransaction();
    await flushWaitUntil();

    expect(grantSignupBonusCreditsMock).toHaveBeenCalled();
    expect(stripeCreateUserCustomerMock).toHaveBeenCalled();
    expect(webhookCallUserWebhookMock).toHaveBeenCalledWith(
      "userCreated",
      expect.anything(),
    );
  });

  it("does not mark tasks as topped up when the signup bonus already exists", async () => {
    grantSignupBonusCreditsMock.mockResolvedValueOnce({
      bucketId: "bucket-existing",
      created: false,
    });

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

    await flushWaitUntil();
    expect(grantSignupBonusCreditsMock).toHaveBeenCalled();
    expect(markOutOfCreditsTasksAsToppedUpMock).not.toHaveBeenCalled();
  });

  it("reports signup bonus grant failures to Sentry without blocking user creation", async () => {
    grantSignupBonusCreditsMock.mockRejectedValueOnce(
      new Error("bonus failed"),
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

    expect(waitUntilMock).toHaveBeenCalledTimes(3);
    await flushWaitUntil();
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith({
      email: "andreas@example.com",
      name: "Andreas",
      userId: "user_123",
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        userId: "user_123",
      },
      tags: {
        context: "signup_bonus_grant",
      },
    });
  });

  it("does not create a personal workspace on user create", async () => {
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

    expect(workspaceUpsertMock).not.toHaveBeenCalled();
    await flushWaitUntil();
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith({
      email: "andreas@example.com",
      name: "Andreas",
      userId: "user_123",
    });
  });

  it("reports Stripe customer creation failures to Sentry without the address or name", async () => {
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

    expect(workspaceUpsertMock).not.toHaveBeenCalled();
    await flushWaitUntil();
    expect(sentryCaptureExceptionMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: { userId: "user_123" },
      tags: {
        context: "stripe_user_customer_creation",
      },
    });
    const report = JSON.stringify(sentryCaptureExceptionMock.mock.calls[0][1]);
    expect(report).not.toContain("andreas@example.com");
    expect(report).not.toContain("Andreas");
  });

  it("sets activeOrganizationId from preferred organization on session create", async () => {
    resolveActiveOrganizationIdForSessionMock.mockResolvedValue("org_pref");

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            session: {
              create: {
                before: (session: { userId: string }) => Promise<{
                  data: { activeOrganizationId: string | null; userId: string };
                }>;
              };
            };
          };
        },
      ]
    >;

    const result = await config.databaseHooks.session.create.before({
      userId: "user_123",
    });

    expect(result.data.activeOrganizationId).toBe("org_pref");
    expect(resolveActiveOrganizationIdForSessionMock).toHaveBeenCalledWith(
      "user_123",
    );
  });

  it("calls user created webhook after user create", async () => {
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
      id: "user_123",
      email: "test@example.com",
      name: "Test",
    });

    await flushWaitUntil();
    expect(webhookCallUserWebhookMock).toHaveBeenCalledWith("userCreated", {
      id: "user_123",
      email: "test@example.com",
      name: "Test",
    });
  });

  it.each(["/callback/:id/oauth-proxy", "/oauth-proxy-callback"])(
    "refuses a proxied sign-in on %s outside a preview",
    async (path) => {
      getEnvMock.mockReturnValue({
        ...getDefaultEnv(),
        VERCEL_ENV: "production",
      });

      await import("./auth");

      const [[config]] = betterAuthMock.mock.calls as Array<
        [{ hooks: { before: (ctx: { path: string }) => Promise<void> } }]
      >;

      await expect(config.hooks.before({ path })).rejects.toMatchObject({
        status: "NOT_FOUND",
      });
    },
  );

  it("completes a proxied sign-in on a preview", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      VERCEL_ENV: "preview",
    });

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ hooks: { before: (ctx: { path: string }) => Promise<void> } }]
    >;

    await expect(
      config.hooks.before({ path: "/callback/:id/oauth-proxy" }),
    ).resolves.toBeUndefined();
  });

  describe("persistent sessions", () => {
    type AfterHookContext = {
      context: {
        authCookies: {
          dontRememberToken: {
            attributes: { httpOnly: boolean; path: string };
            name: string;
          };
        };
        newSession?: {
          session: { id?: string; impersonatedBy?: string | null };
          user?: object;
        };
        returned?: unknown;
      };
      path: string;
      setCookie: (
        name: string,
        value: string,
        attributes: { httpOnly: boolean; maxAge: number; path: string },
      ) => void;
    };

    async function runAfterHook(
      path: string,
      context: Pick<AfterHookContext["context"], "newSession" | "returned">,
    ) {
      await import("./auth");
      const [[config]] = betterAuthMock.mock.calls as Array<
        [{ hooks: { after: (ctx: AfterHookContext) => Promise<void> } }]
      >;
      const setCookie = vi.fn();
      await config.hooks.after({
        context: {
          authCookies: {
            dontRememberToken: {
              attributes: { httpOnly: true, path: "/" },
              name: "sokosumi.dont_remember",
            },
          },
          ...context,
        },
        path,
        setCookie,
      });
      return setCookie;
    }

    function expectRewritten(
      setCookie: ReturnType<typeof vi.fn>,
      newSession: unknown,
    ) {
      expect(setSessionCookieMock).toHaveBeenCalledWith(
        expect.objectContaining({ setCookie }),
        newSession,
        false,
      );
      expect(setCookie).toHaveBeenCalledWith("sokosumi.dont_remember", "", {
        httpOnly: true,
        maxAge: 0,
        path: "/",
      });
    }

    it("keeps a new session persistent and drops a stale dont_remember cookie", async () => {
      const newSession = { session: {}, user: {} };
      const setCookie = await runAfterHook("/sign-in/email-otp", {
        newSession,
        returned: { token: "session-token" },
      });

      expectRewritten(setCookie, newSession);
    });

    // The social callback ends with `throw c.redirect(...)`, an APIError with
    // status FOUND. It is a success, and its cookies still reach the browser.
    it("keeps a session from an OAuth callback redirect persistent", async () => {
      const { APIError } = await import("better-auth/api");
      const newSession = { session: {}, user: {} };
      const setCookie = await runAfterHook("/callback/google", {
        newSession,
        returned: new APIError("FOUND"),
      });

      expectRewritten(setCookie, newSession);
    });

    it("leaves the cookies alone when the endpoint failed", async () => {
      const { APIError } = await import("better-auth/api");
      const setCookie = await runAfterHook("/passkey/verify-authentication", {
        newSession: { session: {}, user: {} },
        returned: new APIError("UNAUTHORIZED"),
      });

      expect(setSessionCookieMock).not.toHaveBeenCalled();
      expect(setCookie).not.toHaveBeenCalled();
    });

    // The OAuth provider resumes authorize through these hooks after a
    // sign-in; setting the cookie there would make it resume again.
    it("leaves the cookie to the sign-in when the OAuth provider resumes authorize", async () => {
      const setCookie = await runAfterHook("/oauth2/authorize", {
        newSession: { session: {}, user: {} },
        returned: { redirect: true, url: "https://app.cmo.xyz/callback" },
      });

      expect(setSessionCookieMock).not.toHaveBeenCalled();
      expect(setCookie).not.toHaveBeenCalled();
    });

    // Impersonation is session-only on purpose: closing the browser ends it.
    it("keeps an impersonation session session-only", async () => {
      const setCookie = await runAfterHook("/admin/impersonate-user", {
        newSession: {
          session: { impersonatedBy: "admin-1" },
          user: {},
        },
        returned: { session: {} },
      });

      expect(setSessionCookieMock).not.toHaveBeenCalled();
      expect(setCookie).not.toHaveBeenCalled();
    });

    // The provider's after hook runs next and continues this request.
    it("lets a session started for an OAuth request answer its Create account prompt", async () => {
      const oauthRequest = { query: "client_id=cmo&prompt=create+consent" };
      getOAuthProviderStateMock.mockResolvedValue(oauthRequest);

      await runAfterHook("/sign-in/email-otp", {
        newSession: {
          session: { id: "session-new" },
          user: {},
        },
        returned: { token: "session-token" },
      });

      expect(oauthRequest.query).toBe("client_id=cmo&prompt=consent");
    });
  });
  it("delivers the committed Calendar revocation after leaving an organization", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          hooks: {
            after: (ctx: {
              body?: Record<string, unknown>;
              context: Record<string, unknown>;
              path: string;
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.hooks.after({
      body: { organizationId: "org-1" },
      context: { session: { user: { id: "user-1" } } },
      path: "/organization/leave",
    });

    expect(
      deliverOrganizationCalendarInvalidationsNowMock,
    ).toHaveBeenCalledWith("org-1", "user-1");
  });

  it("prepares the Stripe email sync before a user update", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              update: {
                before: (
                  data: Record<string, unknown>,
                  ctx: unknown,
                ) => Promise<{ data: Record<string, unknown> }>;
              };
            };
          };
        },
      ]
    >;

    const updateData = { email: "new@example.com" };
    const ctx = { session: { user: { id: "user_123" } } };

    const result = await config.databaseHooks.user.update.before(
      updateData,
      ctx,
    );

    expect(prepareStripeEmailSyncForUserUpdateMock).toHaveBeenCalledWith(
      updateData,
      ctx,
      prismaMock,
    );
    expect(result).toEqual({ data: updateData });
  });

  it("calls the user updated webhook and Stripe email sync after a user update", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            user: {
              update: {
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

    const user = { id: "user_123", email: "new@example.com", name: "Andreas" };

    await config.databaseHooks.user.update.after(user);

    expect(webhookCallUserWebhookMock).toHaveBeenCalledWith(
      "userUpdated",
      user,
    );
    expect(handleUserUpdateStripeEmailSyncMock).toHaveBeenCalledWith(user);
    // Kept alive past the response, like the webhook. Compared by identity:
    // any two promises are equal to toHaveBeenCalledWith.
    expect(waitUntilMock.mock.calls.map(([promise]) => promise)).toContain(
      handleUserUpdateStripeEmailSyncMock.mock.results[0]?.value,
    );
  });

  it("reports preferred organization resolution failures to Sentry and keeps the session", async () => {
    resolveActiveOrganizationIdForSessionMock.mockRejectedValueOnce(
      new Error("preferred org failed"),
    );

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          databaseHooks: {
            session: {
              create: {
                before: (session: { userId: string }) => Promise<{
                  data: {
                    activeOrganizationId?: string | null;
                    userId: string;
                  };
                }>;
              };
            };
          };
        },
      ]
    >;

    const result = await config.databaseHooks.session.create.before({
      userId: "user_123",
    });

    expect(result.data).toEqual({ userId: "user_123" });
    expect(result.data.activeOrganizationId).toBeUndefined();
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: { userId: "user_123" },
      tags: { context: "session_create_preferred_organization" },
    });
  });
});
