jest.mock("server-only", () => ({}));

const getEnvSecretsMock = jest.fn(() => ({
  STRIPE_ONBOARD_ORGANIZATION_COUPON: "cp_org",
  STRIPE_ONBOARD_PERSONAL_COUPON: "cp_personal",
  STRIPE_SECRET_KEY: "sk_test_mock",
}));

const getUserByIdMock = jest.fn();
const createUserCustomerMock = jest.fn();
const createSubscriptionMock = jest.fn();
const listSubscriptionsMock = jest.fn();
const getSubscriptionCatalogMock = jest.fn();
const updateUserMock = jest.fn();

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

jest.mock("@/lib/auth/utils", () => ({
  verifyUserId: jest.fn(),
}));

jest.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {},
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

const prismaMock = {
  organization: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: (...args: unknown[]) => updateUserMock(...args),
  },
};

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: prismaMock,
}));

jest.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    createSubscription: (...args: unknown[]) => createSubscriptionMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
    listSubscriptions: (...args: unknown[]) => listSubscriptionsMock(...args),
  },
}));

jest.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

describe("stripeService.ensurePersonalFreeSubscription", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("skips free subscription when user already has an active personal subscription", async () => {
    getUserByIdMock.mockResolvedValue({
      email: "user@example.com",
      id: "user-1",
      name: "User 1",
      stripeCustomerId: "cus_existing",
    });
    listSubscriptionsMock.mockResolvedValue([
      {
        status: "active",
      },
    ]);

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.ensurePersonalFreeSubscription("user-1");

    expect(result).toEqual({
      reason: "ALREADY_HAS_SUBSCRIPTION",
      status: "skipped",
    });
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("creates missing customer and enrolls user into free subscription", async () => {
    getUserByIdMock.mockResolvedValue({
      email: "user@example.com",
      id: "user-1",
      name: "User 1",
      stripeCustomerId: null,
    });
    createUserCustomerMock.mockResolvedValue({
      id: "cus_new",
    });
    listSubscriptionsMock.mockResolvedValue([]);
    getSubscriptionCatalogMock.mockResolvedValue({
      free: {
        priceId: "price_free",
      },
    });
    createSubscriptionMock.mockResolvedValue({
      id: "sub_free",
    });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.ensurePersonalFreeSubscription("user-1");

    expect(result).toEqual({
      status: "created",
      subscriptionId: "sub_free",
    });
    expect(updateUserMock).toHaveBeenCalledWith({
      data: {
        stripeCustomerId: "cus_new",
      },
      where: {
        id: "user-1",
      },
    });
    expect(createSubscriptionMock).toHaveBeenCalledWith(
      "cus_new",
      "price_free",
      "free-plan-user-user-1",
    );
  });

  it("returns failed when free plan configuration is invalid", async () => {
    getUserByIdMock.mockResolvedValue({
      email: "user@example.com",
      id: "user-1",
      name: "User 1",
      stripeCustomerId: "cus_existing",
    });
    listSubscriptionsMock.mockResolvedValue([]);
    getSubscriptionCatalogMock.mockRejectedValue(
      new Error("Missing free plan price"),
    );

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.ensurePersonalFreeSubscription("user-1");

    expect(result).toEqual({
      reason: "INVALID_FREE_PLAN_CONFIGURATION",
      status: "failed",
    });
    expect(createSubscriptionMock).not.toHaveBeenCalled();
  });

  it("removes the legacy welcome coupon entry point", async () => {
    const { stripeService } = await import("../stripe.service");
    expect((stripeService as Record<string, unknown>).claimWelcomeCoupon).toBe(
      undefined,
    );
  });
});
