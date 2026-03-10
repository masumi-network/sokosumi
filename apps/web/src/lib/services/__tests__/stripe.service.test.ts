jest.mock("server-only", () => ({}));

const headersMock = jest.fn();
const verifyUserIdMock = jest.fn();
const createCheckoutSessionMock = jest.fn();
const createUserCustomerMock = jest.fn();
const createOrganizationCustomerMock = jest.fn();
const getUserByIdMock = jest.fn();
const getOrganizationWithRelationsByIdMock = jest.fn();
const userFindUniqueMock = jest.fn();
const userUpdateMock = jest.fn();
const organizationFindUniqueMock = jest.fn();
const organizationUpdateMock = jest.fn();

jest.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
}));

jest.mock("@/lib/auth/utils", () => ({
  verifyUserId: (...args: unknown[]) => verifyUserIdMock(...args),
}));

jest.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    createCheckoutSession: (...args: unknown[]) =>
      createCheckoutSessionMock(...args),
    createOrganizationCustomer: (...args: unknown[]) =>
      createOrganizationCustomerMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
  },
}));

jest.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    getOrganizationWithRelationsById: (...args: unknown[]) =>
      getOrganizationWithRelationsByIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
      update: (...args: unknown[]) => organizationUpdateMock(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
  },
}));

jest.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: jest.fn(),
}));

jest.mock("stripe", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

describe("stripeService.createStripeCheckoutSession", () => {
  const price = {
    id: "price_1",
    amountPerCredit: 10,
    currency: "eur",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    verifyUserIdMock.mockResolvedValue(true);
    headersMock.mockResolvedValue(
      new Headers({
        origin: "https://app.sokosumi.com",
      }),
    );
    createCheckoutSessionMock.mockResolvedValue({
      url: "https://checkout.stripe.com/session/test",
    });
  });

  it("reuses the existing personal Stripe customer", async () => {
    userFindUniqueMock.mockResolvedValue({
      stripeCustomerId: "cus_existing",
    });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.createStripeCheckoutSession(
      "user-1",
      null,
      250_000,
      price,
    );

    expect(createUserCustomerMock).not.toHaveBeenCalled();
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      "cus_existing",
      "user-1",
      null,
      250_000,
      price,
      "https://app.sokosumi.com",
      null,
      "/billing?tab=credits",
      undefined,
    );
    expect(result).toEqual({
      url: "https://checkout.stripe.com/session/test",
    });
  });

  it("creates a personal Stripe customer when missing without persisting it", async () => {
    userFindUniqueMock.mockResolvedValue({
      stripeCustomerId: null,
    });
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      name: "Jane Doe",
      email: "jane@example.com",
    });
    createUserCustomerMock.mockResolvedValue({
      id: "cus_new_user",
    });
    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.createStripeCheckoutSession(
      "user-1",
      null,
      250_000,
      price,
    );

    expect(createUserCustomerMock).toHaveBeenCalledWith(
      "user-1",
      "Jane Doe",
      "jane@example.com",
    );
    expect(userUpdateMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      "cus_new_user",
      "user-1",
      null,
      250_000,
      price,
      "https://app.sokosumi.com",
      null,
      "/billing?tab=credits",
      undefined,
    );
    expect(result).toEqual({
      url: "https://checkout.stripe.com/session/test",
    });
  });

  it("creates an organization Stripe customer when missing without persisting it", async () => {
    organizationFindUniqueMock.mockResolvedValue({
      stripeCustomerId: null,
    });
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org-1",
      slug: "org-one",
      name: "Org One",
      invoiceEmail: "billing@org-one.com",
    });
    createOrganizationCustomerMock.mockResolvedValue({
      id: "cus_new_org",
    });
    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.createStripeCheckoutSession(
      "user-1",
      "org-1",
      250_000,
      price,
    );

    expect(createOrganizationCustomerMock).toHaveBeenCalledWith(
      "org-1",
      "org-one",
      "Org One",
      "billing@org-one.com",
    );
    expect(organizationUpdateMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      "cus_new_org",
      "user-1",
      "org-1",
      250_000,
      price,
      "https://app.sokosumi.com",
      null,
      "/billing?tab=credits",
      undefined,
    );
    expect(result).toEqual({
      url: "https://checkout.stripe.com/session/test",
    });
  });
});
