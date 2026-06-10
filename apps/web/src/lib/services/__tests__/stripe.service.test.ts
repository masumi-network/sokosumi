import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const headersMock = vi.fn();
const verifyUserIdMock = vi.fn();
const createCheckoutSessionMock = vi.fn();
const createUserCustomerMock = vi.fn();
const createOrganizationCustomerMock = vi.fn();
const getUserByIdMock = vi.fn();
const getOrganizationWithRelationsByIdMock = vi.fn();
const userUpdateMock = vi.fn();
const organizationUpdateMock = vi.fn();
const getMyStripeCustomerMock = vi.fn();
const getOrganizationStripeCustomerMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
}));

vi.mock("@/lib/auth/utils", () => ({
  verifyUserId: (...args: unknown[]) => verifyUserIdMock(...args),
}));

vi.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    createCheckoutSession: (...args: unknown[]) =>
      createCheckoutSessionMock(...args),
    createOrganizationCustomer: (...args: unknown[]) =>
      createOrganizationCustomerMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
  },
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    getOrganizationWithRelationsById: (...args: unknown[]) =>
      getOrganizationWithRelationsByIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    organization: {
      update: (...args: unknown[]) => organizationUpdateMock(...args),
    },
    user: {
      update: (...args: unknown[]) => userUpdateMock(...args),
    },
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getMyStripeCustomer: (...args: unknown[]) =>
      getMyStripeCustomerMock(...args),
    getOrganizationById: (...args: unknown[]) =>
      getOrganizationWithRelationsByIdMock(...args),
    getOrganizationStripeCustomer: (...args: unknown[]) =>
      getOrganizationStripeCustomerMock(...args),
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

vi.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: vi.fn(),
}));

vi.mock("stripe", () => ({
  __esModule: true,
  default: vi.fn(function MockStripe() {
    return {};
  }),
}));

describe("stripeService.createStripeCheckoutSession", () => {
  const price = {
    id: "price_1",
    amountPerCredit: 10,
    currency: "eur",
  };

  beforeEach(() => {
    vi.clearAllMocks();
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
    getMyStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_existing" },
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
    getMyStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: null },
    });
    getUserByIdMock.mockResolvedValue({
      data: {
        id: "user-1",
        name: "Jane Doe",
        email: "jane@example.com",
      },
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
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: null },
    });
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      data: {
        id: "org-1",
        slug: "org-one",
        name: "Org One",
        metadata: { invoiceEmail: "billing@org-one.com" },
      },
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
