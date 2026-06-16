import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const headersMock = vi.fn();
const verifyUserIdMock = vi.fn();
const createCheckoutSessionMock = vi.fn();
const updateCustomerEmailMock = vi.fn();
const getPromotionCodeMock = vi.fn();
const createPromotionCodeMock = vi.fn();
const createMyStripeCustomerMock = vi.fn();
const createOrganizationStripeCustomerMock = vi.fn();
const getOrganizationStripeCustomerMock = vi.fn();

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  verifyUserId: (...args: unknown[]) => verifyUserIdMock(...args),
}));

vi.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    createCheckoutSession: (...args: unknown[]) =>
      createCheckoutSessionMock(...args),
    updateCustomerEmail: (...args: unknown[]) =>
      updateCustomerEmailMock(...args),
    getPromotionCode: (...args: unknown[]) => getPromotionCodeMock(...args),
    createPromotionCode: (...args: unknown[]) =>
      createPromotionCodeMock(...args),
  },
}));

vi.mock("@/lib/clients/core.client", () => {
  class CoreApiRequestError extends Error {
    details?: unknown;
    status?: number;
    kind?: string;

    constructor(
      message: string,
      options?: { details?: unknown; status?: number; kind?: string },
    ) {
      super(message);
      this.name = "CoreApiRequestError";
      this.details = options?.details;
      this.status = options?.status;
      this.kind = options?.kind;
    }
  }

  return {
    CoreApiRequestError,
    coreClient: {
      createMyStripeCustomer: (...args: unknown[]) =>
        createMyStripeCustomerMock(...args),
      createOrganizationStripeCustomer: (...args: unknown[]) =>
        createOrganizationStripeCustomerMock(...args),
      getOrganizationStripeCustomer: (...args: unknown[]) =>
        getOrganizationStripeCustomerMock(...args),
    },
  };
});

vi.mock("stripe", () => ({
  __esModule: true,
  default: vi.fn(function MockStripe() {
    return {};
  }),
}));

async function makeCoreNotFoundError(kind?: string) {
  const { CoreApiRequestError } = await import("@/lib/clients/core.client");
  return new CoreApiRequestError("Not Found", { status: 404, kind });
}

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

  it("ensures the personal Stripe customer via core", async () => {
    createMyStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_user" },
    });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.createStripeCheckoutSession(
      "user-1",
      null,
      250_000,
      price,
    );

    expect(createMyStripeCustomerMock).toHaveBeenCalledTimes(1);
    expect(createOrganizationStripeCustomerMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      "cus_user",
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

  it("ensures the organization Stripe customer via core", async () => {
    createOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org" },
    });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.createStripeCheckoutSession(
      "user-1",
      "org-1",
      250_000,
      price,
    );

    expect(createOrganizationStripeCustomerMock).toHaveBeenCalledWith("org-1");
    expect(createMyStripeCustomerMock).not.toHaveBeenCalled();
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      "cus_org",
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

  it("throws when core reports the organization as missing", async () => {
    createOrganizationStripeCustomerMock.mockRejectedValue(
      await makeCoreNotFoundError("organization_not_found"),
    );

    const { stripeService } = await import("../stripe.service");

    await expect(
      stripeService.createStripeCheckoutSession("user-1", "org-1", 100, price),
    ).rejects.toThrow("Stripe customer not found");
    expect(createCheckoutSessionMock).not.toHaveBeenCalled();
  });

  it("rejects unverified users before touching core", async () => {
    verifyUserIdMock.mockResolvedValue(false);

    const { stripeService } = await import("../stripe.service");

    await expect(
      stripeService.createStripeCheckoutSession("user-1", null, 100, price),
    ).rejects.toThrow("User is not authenticated");
    expect(createMyStripeCustomerMock).not.toHaveBeenCalled();
  });
});

describe("stripeService.claimCoupon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing promotion code without creating a duplicate", async () => {
    createMyStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_user" },
    });
    getPromotionCodeMock.mockResolvedValue({ id: "promo_existing" });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.claimCoupon("coupon_1", 1, {
      userId: "user-1",
      organizationId: null,
    });

    expect(result).toEqual({ id: "promo_existing" });
    expect(getPromotionCodeMock).toHaveBeenCalledWith("cus_user", "coupon_1");
    expect(createPromotionCodeMock).not.toHaveBeenCalled();
  });

  it("creates a promotion code when none exists", async () => {
    createOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org" },
    });
    getPromotionCodeMock.mockResolvedValue(null);
    createPromotionCodeMock.mockResolvedValue({ id: "promo_new" });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.claimCoupon("coupon_1", 1, {
      userId: "user-1",
      organizationId: "org-1",
    });

    expect(result).toEqual({ id: "promo_new" });
    expect(createPromotionCodeMock).toHaveBeenCalledWith(
      "cus_org",
      "coupon_1",
      1,
      undefined,
    );
  });

  it("returns null when the billing entity does not exist", async () => {
    createMyStripeCustomerMock.mockRejectedValue(await makeCoreNotFoundError());

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.claimCoupon("coupon_1", 1, {
      userId: "user-1",
      organizationId: null,
    });

    expect(result).toBeNull();
    expect(getPromotionCodeMock).not.toHaveBeenCalled();
  });
});

describe("stripeService.syncOrganizationInvoiceEmailWithStripe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the Stripe customer email when provisioned", async () => {
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org" },
    });
    updateCustomerEmailMock.mockResolvedValue({});

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.syncOrganizationInvoiceEmailWithStripe(
      "org-1",
      "billing@acme.test",
    );

    expect(result).toBe(true);
    expect(updateCustomerEmailMock).toHaveBeenCalledWith(
      "cus_org",
      "billing@acme.test",
    );
  });

  it("returns true when no Stripe customer is provisioned", async () => {
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: null },
    });

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.syncOrganizationInvoiceEmailWithStripe(
      "org-1",
      "billing@acme.test",
    );

    expect(result).toBe(true);
    expect(updateCustomerEmailMock).not.toHaveBeenCalled();
  });

  it("returns true when the organization does not exist", async () => {
    getOrganizationStripeCustomerMock.mockRejectedValue(
      await makeCoreNotFoundError("organization_not_found"),
    );

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.syncOrganizationInvoiceEmailWithStripe(
      "org-1",
      "billing@acme.test",
    );

    expect(result).toBe(true);
    expect(updateCustomerEmailMock).not.toHaveBeenCalled();
  });

  it("returns false when the Stripe update fails", async () => {
    getOrganizationStripeCustomerMock.mockResolvedValue({
      data: { stripeCustomerId: "cus_org" },
    });
    updateCustomerEmailMock.mockRejectedValue(new Error("stripe down"));

    const { stripeService } = await import("../stripe.service");

    const result = await stripeService.syncOrganizationInvoiceEmailWithStripe(
      "org-1",
      "billing@acme.test",
    );

    expect(result).toBe(false);
  });
});

