import { MemberRole } from "@sokosumi/database";
import { ENTERPRISE_SUBSCRIPTION_EXCLUSIVITY_MESSAGE } from "@sokosumi/database/helpers";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  oAuthProxyPluginMock,
  openAPIPluginMock,
  organizationPluginMock,
  magicLinkPluginMock,
  markOutOfCreditsTasksAsToppedUpMock,
  getMemberByUserIdAndOrganizationIdMock,
  getMembersByOrganizationIdMock,
  passkeyPluginMock,
  postmarkSendEmailMock,
  prismaAdapterMock,
  prismaMock,
  prismaTransactionMock,
  reconcileActiveStripeBackedSubscriptionMock,
  renderMagicLinkEmailMock,
  resolveActiveOrganizationIdForSessionMock,
  sentryCaptureExceptionMock,
  stripeCreateUserCustomerMock,
  stripeCreateOrganizationCustomerMock,
  stripePluginMock,
  uploadProfileImageMock,
  webhookCallAccountCreatedMock,
  webhookCallUserCreatedMock,
  webhookCallUserUpdatedMock,
  ensureCanAcceptOrganizationInvitationMock,
  syncLocalFreeSeatsAndCreditsForCurrentMembersMock,
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
  const prismaMock = {
    __prisma: true,
    $transaction: (callback: (tx: unknown) => unknown) =>
      prismaTransactionMock(callback),
  };

  return {
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
    oAuthProxyPluginMock: vi.fn(),
    openAPIPluginMock: vi.fn(),
    organizationPluginMock: vi.fn(),
    magicLinkPluginMock: vi.fn(),
    markOutOfCreditsTasksAsToppedUpMock: vi.fn(),
    getMemberByUserIdAndOrganizationIdMock: vi.fn(),
    getMembersByOrganizationIdMock: vi.fn(),
    passkeyPluginMock: vi.fn(),
    postmarkSendEmailMock: vi.fn(),
    prismaAdapterMock: vi.fn(),
    prismaMock,
    prismaTransactionMock,
    reconcileActiveStripeBackedSubscriptionMock: vi.fn(),
    renderMagicLinkEmailMock: vi.fn(),
    resolveActiveOrganizationIdForSessionMock: vi.fn(),
    sentryCaptureExceptionMock: vi.fn(),
    stripeCreateUserCustomerMock: vi.fn(),
    stripeCreateOrganizationCustomerMock: vi.fn(),
    stripePluginMock: vi.fn(),
    uploadProfileImageMock: vi.fn(),
    webhookCallAccountCreatedMock: vi.fn(),
    webhookCallUserCreatedMock: vi.fn(),
    webhookCallUserUpdatedMock: vi.fn(),
    ensureCanAcceptOrganizationInvitationMock: vi.fn(),
    syncLocalFreeSeatsAndCreditsForCurrentMembersMock: vi.fn(),
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
    BETTER_AUTH_SESSION_COOKIE_CACHE_MAX_AGE: 60,
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    MICROSOFT_CLIENT_ID: "microsoft-client-id",
    MICROSOFT_CLIENT_SECRET: "microsoft-client-secret",
    NETWORK: "Preprod",
    NODE_ENV: "production",
    POSTMARK_FROM_EMAIL: "no-reply@example.com",
    POSTMARK_SERVER_ID: "postmark-server-id",
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_WEBHOOK_SECRET: "whsec_test_123",
    SIGNUP_BONUS_CREDITS: 3000,
    SIGNUP_BONUS_TTL_DAYS: 30,
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
}));

vi.mock("@better-auth/i18n", () => ({
  i18n: (...args: unknown[]) => i18nPluginMock(...args),
}));

// Keep the real APIError (the hooks throw it and tests assert its shape) but
// reduce createAuthMiddleware to an identity wrapper so the terms guards can be
// invoked directly with a plain context in unit tests.
vi.mock("better-auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/api")>();
  return {
    ...actual,
    createAuthMiddleware: (callback: unknown) => callback,
  };
});

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
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
    getMembersByOrganizationId: (...args: unknown[]) =>
      getMembersByOrganizationIdMock(...args),
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
    createUserCustomer: (...args: unknown[]) =>
      stripeCreateUserCustomerMock(...args),
    createOrganizationCustomer: (...args: unknown[]) =>
      stripeCreateOrganizationCustomerMock(...args),
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
  default: prismaMock,
}));

vi.mock("@/lib/blob", () => ({
  uploadProfileImage: (...args: unknown[]) => uploadProfileImageMock(...args),
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

vi.mock("@/services/organization-subscription-auth.service", () => ({
  ensureCanAcceptOrganizationInvitation: (...args: unknown[]) =>
    ensureCanAcceptOrganizationInvitationMock(...args),
  syncLocalFreeSeatsAndCreditsForCurrentMembers: (...args: unknown[]) =>
    syncLocalFreeSeatsAndCreditsForCurrentMembersMock(...args),
}));

vi.mock("@/services/stripe-user-email.service", () => ({
  prepareStripeEmailSyncForUserUpdate: (...args: unknown[]) =>
    prepareStripeEmailSyncForUserUpdateMock(...args),
  handleUserUpdateStripeEmailSync: (...args: unknown[]) =>
    handleUserUpdateStripeEmailSyncMock(...args),
  syncUserEmailWithStripe: (...args: unknown[]) =>
    syncUserEmailWithStripeMock(...args),
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
    getWebAppBaseUrlMock.mockReturnValue("https://preprod.sokosumi.com");
    jwtPluginMock.mockReturnValue("jwt-plugin");
    lastLoginMethodPluginMock.mockReturnValue("last-login-method-plugin");
    magicLinkPluginMock.mockReturnValue("magic-link-plugin");
    oAuthProxyPluginMock.mockReturnValue("oauth-proxy-plugin");
    oauthProviderPluginMock.mockReturnValue("oauth-provider-plugin");
    openAPIPluginMock.mockReturnValue("openapi-plugin");
    organizationPluginMock.mockReturnValue("organization-plugin");
    passkeyPluginMock.mockReturnValue("passkey-plugin");
    reconcileActiveStripeBackedSubscriptionMock.mockResolvedValue(undefined);
    postmarkSendEmailMock.mockResolvedValue({ MessageID: "message_123" });
    prismaAdapterMock.mockReturnValue("prisma-adapter");
    renderMagicLinkEmailMock.mockResolvedValue({
      html: "<html>magic link</html>",
      subject: "Sokosumi - Sign in to your account",
    });
    sentryCaptureExceptionMock.mockReset();
    stripeCreateUserCustomerMock.mockResolvedValue({ id: "cus_123" });
    uploadProfileImageMock.mockResolvedValue("https://blob.example/avatar.png");
    webhookCallAccountCreatedMock.mockResolvedValue(undefined);
    webhookCallUserCreatedMock.mockResolvedValue(undefined);
    webhookCallUserUpdatedMock.mockResolvedValue(undefined);
    stripePluginMock.mockReturnValue("stripe-plugin");
    workspaceUpsertMock.mockResolvedValue({ id: "workspace_123" });
    betterAuthMock.mockReturnValue({ api: {}, handler: vi.fn() });
    getBetterAuthProductionUrlMock.mockReturnValue("https://example.com/auth");
    getBetterAuthSubscriptionPlansMock.mockResolvedValue([]);
    hasConsumableEnterpriseContractMock.mockResolvedValue(false);
    handleSubscriptionDeletedEventMock.mockResolvedValue(undefined);
    stripeCreateOrganizationCustomerMock.mockResolvedValue({
      id: "cus_org_123",
    });
    ensureCanAcceptOrganizationInvitationMock.mockResolvedValue(undefined);
    syncLocalFreeSeatsAndCreditsForCurrentMembersMock.mockResolvedValue(
      undefined,
    );
    prepareStripeEmailSyncForUserUpdateMock.mockResolvedValue(undefined);
    handleUserUpdateStripeEmailSyncMock.mockResolvedValue(undefined);
    syncUserEmailWithStripeMock.mockResolvedValue(undefined);
    grantSignupBonusCreditsMock.mockResolvedValue({ created: true });
    waitUntilCapturedPromises.length = 0;
    waitUntilMock.mockClear();
  });

  it("configures Google and Microsoft social providers for auth parity", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          socialProviders: {
            google: {
              clientId: string;
              clientSecret: string;
              overrideUserInfoOnSignIn: boolean;
              mapProfileToUser: unknown;
            };
            microsoft: {
              clientId: string;
              clientSecret: string;
              overrideUserInfoOnSignIn: boolean;
              mapProfileToUser: unknown;
            };
          };
          account: {
            accountLinking: {
              enabled: boolean;
              trustedProviders: string[];
            };
          };
        },
      ]
    >;

    expect(config.socialProviders.google).toEqual({
      clientId: "google-client-id",
      clientSecret: "google-client-secret",
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: expect.any(Function),
    });
    expect(config.socialProviders.microsoft).toEqual({
      clientId: "microsoft-client-id",
      clientSecret: "microsoft-client-secret",
      overrideUserInfoOnSignIn: true,
      mapProfileToUser: expect.any(Function),
    });
    expect(config.socialProviders.google.mapProfileToUser).toBe(
      config.socialProviders.microsoft.mapProfileToUser,
    );
    expect(config.account.accountLinking).toEqual({
      enabled: true,
      trustedProviders: ["google", "microsoft"],
    });
  });

  it("maps social profile pictures to user fields", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          socialProviders: {
            google: {
              mapProfileToUser: (profile: {
                name: string;
                picture: string;
              }) => Promise<{ name: string; image?: string | null }>;
            };
          };
        },
      ]
    >;

    const mapProfileToUser = config.socialProviders.google.mapProfileToUser;

    await expect(
      mapProfileToUser({
        name: "Andreas",
        picture: "https://cdn.example.com/avatar.png",
      }),
    ).resolves.toEqual({
      name: "Andreas",
      image: "https://cdn.example.com/avatar.png",
    });

    const dataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    await expect(
      mapProfileToUser({
        name: "Andreas",
        picture: dataUri,
      }),
    ).resolves.toEqual({
      name: "Andreas",
      image: "https://blob.example/avatar.png",
    });
    expect(uploadProfileImageMock).toHaveBeenCalledWith(dataUri);

    await expect(
      mapProfileToUser({
        name: "Andreas",
        picture: "",
      }),
    ).resolves.toEqual({
      name: "Andreas",
      image: undefined,
    });
  });

  it("falls back when social profile mapping fails", async () => {
    uploadProfileImageMock.mockRejectedValueOnce(new Error("upload failed"));

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          socialProviders: {
            google: {
              mapProfileToUser: (profile: {
                name: string;
                picture: string;
              }) => Promise<{ name: string; image?: string | null }>;
            };
          };
        },
      ]
    >;

    await expect(
      config.socialProviders.google.mapProfileToUser({
        name: "Andreas",
        picture: "data:image/png;base64,invalid",
      }),
    ).resolves.toEqual({
      name: "Andreas",
      image: undefined,
    });
    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error));
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

    expect(webhookCallAccountCreatedMock).toHaveBeenCalledWith(
      "user_123",
      "google",
    );
  });

  it("registers the passkey plugin with the Sokosumi relying party configuration", async () => {
    await import("./auth");

    expect(passkeyPluginMock).toHaveBeenCalledWith({
      rpID: "example.com",
      rpName: "Sokosumi",
    });
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
    });
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

  it.each(["onSubscriptionCreated", "onSubscriptionUpdate"] as const)(
    "reconciles local free rows from Better Auth subscription callback %s",
    async (callbackName) => {
      await import("./auth");

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
    },
  );

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

  it("registers the Better Auth admin plugin", async () => {
    await import("./auth");

    expect(betterAuthMock).toHaveBeenCalledTimes(1);
    expect(adminPluginMock).toHaveBeenCalledWith();

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ plugins: unknown[] }]
    >;

    expect(config.plugins).toEqual(expect.arrayContaining(["admin-plugin"]));
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
    expect(config.plugins).toEqual(
      expect.arrayContaining([
        "admin-plugin",
        "api-key-plugin",
        "jwt-plugin",
        "magic-link-plugin",
        "i18n-plugin",
        "openapi-plugin",
        "organization-plugin",
        "passkey-plugin",
        "last-login-method-plugin",
        "oauth-provider-plugin",
        "oauth-proxy-plugin",
        "stripe-plugin",
      ]),
    );
    expect(apiKeyPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        configId: "default",
        references: "user",
        enableMetadata: true,
        enableSessionForAPIKeys: true,
      }),
    );
    expect(jwtPluginMock).toHaveBeenCalledWith({
      disableSettingJwtHeader: true,
    });
  });

  it("uses explicit Sokosumi app trustedOrigins in production", async () => {
    getEnvMock.mockReturnValue({
      ...getDefaultEnv(),
      NODE_ENV: "production",
    });

    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [{ trustedOrigins: string[] }]
    >;

    expect(config.trustedOrigins).toEqual([
      "https://app.sokosumi.com",
      "https://preprod.sokosumi.com",
      "https://*.preview.sokosumi.com",
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
      "https://*.preview.sokosumi.com",
      "http://localhost:*",
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

  it("uses uuid database ids and database-backed rate limits", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          advanced: {
            database: {
              generateId: string;
            };
          };
          experimental: {
            joins: boolean;
          };
          rateLimit: {
            storage: string;
          };
        },
      ]
    >;

    expect(config.advanced.database.generateId).toBe("uuid");
    expect(config.experimental.joins).toBe(true);
    expect(config.rateLimit.storage).toBe("database");
  });

  it("defines user and organization additional fields for auth parity", async () => {
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
        "notificationsOptIn",
        "logo",
        "metadata",
        "stripeCustomerId",
        "onboardingCompleted",
      ]),
    );
    expect(config.user.additionalFields.stripeCustomerId).toEqual({
      type: "string",
      required: false,
      defaultValue: null,
      input: false,
    });

    const [[organizationConfig]] = organizationPluginMock.mock.calls as Array<
      [
        {
          schema: {
            organization: {
              additionalFields: Record<string, { input?: boolean }>;
            };
          };
        },
      ]
    >;

    expect(organizationConfig.schema.organization.additionalFields).toEqual({
      stripeCustomerId: {
        type: "string",
        required: false,
        defaultValue: null,
        input: false,
      },
    });
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

  it("prefers the locale cookie over accept-language for magic-link emails", async () => {
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
      tx: {},
      userId: "user_123",
    });
    expect(waitUntilMock).toHaveBeenCalledTimes(3);
    await flushWaitUntil();
    expect(stripeCreateUserCustomerMock).toHaveBeenCalledWith({
      email: " magic@example.com ",
      name: "magic",
      userId: "user_123",
    });
    expect(prismaTransactionMock).toHaveBeenCalled();
    expect(grantSignupBonusCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credits: 3000,
        userId: "user_123",
      }),
      {},
    );
    expect(markOutOfCreditsTasksAsToppedUpMock).toHaveBeenCalledWith({
      organizationId: null,
      tx: {},
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
      tx: {},
      userId: "user_123",
    });
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
      {},
    );
  });

  it("registers signup side effects with waitUntil without awaiting them in the after hook", async () => {
    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    let transactionCalls = 0;
    prismaTransactionMock.mockImplementation(async (callback) => {
      transactionCalls += 1;
      if (transactionCalls === 1) {
        return callback({});
      }

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
    expect(webhookCallUserCreatedMock).toHaveBeenCalled();
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
    await flushWaitUntil();
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

    expect(workspaceUpsertMock).toHaveBeenCalledWith({
      tx: {},
      userId: "user_123",
    });
    await flushWaitUntil();
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

  it("blocks organization deletion when additional members remain", async () => {
    getMembersByOrganizationIdMock.mockResolvedValue([
      { userId: "user-1" },
      { userId: "user-2" },
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
        organization: { id: "org-1" },
        user: { id: "user-1" },
      }),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: {
        code: "ORGANIZATION_HAS_ADDITIONAL_MEMBERS",
        message: "Remove all other members before deleting this organization.",
      },
    });

    expect(getMembersByOrganizationIdMock).toHaveBeenCalledWith(
      "org-1",
      prismaMock,
    );
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
    expect(webhookCallUserCreatedMock).toHaveBeenCalledWith({
      id: "user_123",
      email: "test@example.com",
      name: "Test",
    });
  });

  it("rejects email sign-up when terms are not accepted", async () => {
    await import("./auth");

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
      config.hooks.before({ body: {}, path: "/sign-up/email" }),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: { code: "TERMS_NOT_ACCEPTED" },
    });
  });

  it("allows email sign-up when terms are accepted", async () => {
    await import("./auth");

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
        body: { termsAccepted: true },
        path: "/sign-up/email",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects sign-in when the user has not accepted the terms", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          hooks: {
            after: (ctx: {
              context: { newSession?: { user?: { termsAccepted?: boolean } } };
              path: string;
            }) => Promise<void>;
          };
        },
      ]
    >;

    await expect(
      config.hooks.after({
        context: { newSession: { user: { termsAccepted: false } } },
        path: "/sign-in/email",
      }),
    ).rejects.toMatchObject({
      status: "BAD_REQUEST",
      body: { code: "TERMS_NOT_ACCEPTED" },
    });
  });

  it("allows sign-in when the user has accepted the terms", async () => {
    await import("./auth");

    const [[config]] = betterAuthMock.mock.calls as Array<
      [
        {
          hooks: {
            after: (ctx: {
              context: { newSession?: { user?: { termsAccepted?: boolean } } };
              path: string;
            }) => Promise<void>;
          };
        },
      ]
    >;

    await expect(
      config.hooks.after({
        context: { newSession: { user: { termsAccepted: true } } },
        path: "/sign-in/email",
      }),
    ).resolves.toBeUndefined();
  });

  it("checks the subscription before accepting an organization invitation", async () => {
    await import("./auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            beforeAcceptInvitation: (input: {
              organization: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.beforeAcceptInvitation({
      organization: { id: "org-1" },
    });

    expect(ensureCanAcceptOrganizationInvitationMock).toHaveBeenCalledWith(
      "org-1",
    );
  });

  it("syncs local free seats and credits after accepting an invitation", async () => {
    await import("./auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterAcceptInvitation: (input: {
              organization: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.afterAcceptInvitation({
      organization: { id: "org-1" },
    });

    expect(
      syncLocalFreeSeatsAndCreditsForCurrentMembersMock,
    ).toHaveBeenCalledWith("org-1");
  });

  it("syncs local free seats and credits after adding a member", async () => {
    await import("./auth");

    const [[config]] = organizationPluginMock.mock.calls as Array<
      [
        {
          organizationHooks: {
            afterAddMember: (input: {
              organization: { id: string };
            }) => Promise<void>;
          };
        },
      ]
    >;

    await config.organizationHooks.afterAddMember({
      organization: { id: "org-1" },
    });

    expect(
      syncLocalFreeSeatsAndCreditsForCurrentMembersMock,
    ).toHaveBeenCalledWith("org-1");
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
        id: "org-1",
        metadata: null,
        name: "Org One",
        slug: "org-one",
      },
    });

    expect(stripeCreateOrganizationCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        name: "Org One",
        slug: "org-one",
      }),
    );
  });

  it("reports Stripe organization customer creation failures to Sentry", async () => {
    stripeCreateOrganizationCustomerMock.mockRejectedValueOnce(
      new Error("stripe org failed"),
    );

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
        id: "org-1",
        metadata: null,
        name: "Org One",
        slug: "org-one",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        organizationId: "org-1",
        organizationName: "Org One",
        organizationSlug: "org-one",
      },
      tags: {
        context: "stripe_organization_customer_creation",
      },
    });
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

    expect(webhookCallUserUpdatedMock).toHaveBeenCalledWith(user);
    expect(handleUserUpdateStripeEmailSyncMock).toHaveBeenCalledWith(user);
  });

  it("reports user updated webhook failures to Sentry", async () => {
    webhookCallUserUpdatedMock.mockRejectedValueOnce(new Error("webhook down"));

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

    await config.databaseHooks.user.update.after({
      id: "user_123",
      email: "new@example.com",
      name: "Andreas",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sentryCaptureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: { userId: "user_123" },
      tags: { context: "user_updated_webhook" },
    });
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
