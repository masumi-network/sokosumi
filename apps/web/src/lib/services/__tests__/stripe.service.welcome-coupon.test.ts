jest.mock("server-only", () => ({}));

const getUserByIdMock = jest.fn();
const getCouponByIdMock = jest.fn();
const applyInvoiceCreditsToCustomerMock = jest.fn();

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
    STRIPE_WELCOME_COUPON: "cp_welcome",
  }),
}));

jest.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {},
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
  },
}));

jest.mock("@/lib/auth/utils", () => ({
  verifyUserId: jest.fn(),
}));

jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    applyInvoiceCreditsToCustomer: (...args: unknown[]) =>
      applyInvoiceCreditsToCustomerMock(...args),
    getCouponById: (...args: unknown[]) => getCouponByIdMock(...args),
  },
}));

describe("stripeService.claimWelcomeCoupon", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("applies the configured welcome coupon for a user customer", async () => {
    getUserByIdMock.mockResolvedValue({
      email: "user@example.com",
      id: "user-1",
      stripeCustomerId: "cus_1",
    });
    getCouponByIdMock.mockResolvedValue({
      id: "cp_welcome",
    });
    applyInvoiceCreditsToCustomerMock.mockResolvedValue({
      id: "in_welcome_1",
    });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.claimWelcomeCoupon("user-1");

    expect(result).toEqual({
      couponApplied: true,
      invoiceId: "in_welcome_1",
    });
    expect(getCouponByIdMock).toHaveBeenCalledWith("cp_welcome");
    expect(applyInvoiceCreditsToCustomerMock).toHaveBeenCalledWith(
      "cus_1",
      "cp_welcome",
      {
        redemption_type: "welcome_coupon",
        user_email: "user@example.com",
        user_id: "user-1",
        welcome_source: "customer.created",
      },
    );
  });

  it("returns failure when user is missing", async () => {
    getUserByIdMock.mockResolvedValue(null);

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.claimWelcomeCoupon("missing-user");

    expect(result).toEqual({
      couponApplied: false,
      invoiceId: null,
    });
    expect(getCouponByIdMock).not.toHaveBeenCalled();
    expect(applyInvoiceCreditsToCustomerMock).not.toHaveBeenCalled();
  });

  it("returns failure when user has no stripe customer id", async () => {
    getUserByIdMock.mockResolvedValue({
      email: "user@example.com",
      id: "user-1",
      stripeCustomerId: null,
    });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.claimWelcomeCoupon("user-1");

    expect(result).toEqual({
      couponApplied: false,
      invoiceId: null,
    });
    expect(getCouponByIdMock).not.toHaveBeenCalled();
    expect(applyInvoiceCreditsToCustomerMock).not.toHaveBeenCalled();
  });

  it("returns failure when Stripe coupon application fails", async () => {
    getUserByIdMock.mockResolvedValue({
      email: "user@example.com",
      id: "user-1",
      stripeCustomerId: "cus_1",
    });
    getCouponByIdMock.mockResolvedValue({
      id: "cp_welcome",
    });
    applyInvoiceCreditsToCustomerMock.mockRejectedValue(
      new Error("Stripe request failed"),
    );

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.claimWelcomeCoupon("user-1");

    expect(result).toEqual({
      couponApplied: false,
      invoiceId: null,
    });
  });
});
