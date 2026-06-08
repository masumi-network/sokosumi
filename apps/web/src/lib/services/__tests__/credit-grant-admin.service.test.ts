import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getOrganizationWithRelationsByIdMock = vi.fn();
const getOrganizationByStripeCustomerIdMock = vi.fn();
const getUserByIdMock = vi.fn();
const getUserByStripeCustomerIdMock = vi.fn();

const createOrganizationCustomerMock = vi.fn();
const createUserCustomerMock = vi.fn();
const createCreditGrantInvoiceMock = vi.fn();
const getBaseCreditTopUpPriceMock = vi.fn();
const getCreditTopUpPriceByIdMock = vi.fn();
const getInvoiceMock = vi.fn();
const payInvoiceOutOfBandMock = vi.fn();
const getAccountIdMock = vi.fn();

const handleInvoicePaidEventMock = vi.fn();
const creditBucketFindFirstMock = vi.fn();
const organizationUpdateMock = vi.fn();
const userUpdateMock = vi.fn();

const buildUserInvoiceCreditReferenceIdMock = vi.fn();
const buildOrganizationInvoiceCreditReferenceIdMock = vi.fn();

vi.mock("@sokosumi/database/helpers", () => ({
  buildUserInvoiceCreditReferenceId: (...args: unknown[]) =>
    buildUserInvoiceCreditReferenceIdMock(...args),
  buildOrganizationInvoiceCreditReferenceId: (...args: unknown[]) =>
    buildOrganizationInvoiceCreditReferenceIdMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    getOrganizationWithRelationsById: (...args: unknown[]) =>
      getOrganizationWithRelationsByIdMock(...args),
    getOrganizationByStripeCustomerId: (...args: unknown[]) =>
      getOrganizationByStripeCustomerIdMock(...args),
  },
  userRepository: {
    getUserById: (...args: unknown[]) => getUserByIdMock(...args),
    getUserByStripeCustomerId: (...args: unknown[]) =>
      getUserByStripeCustomerIdMock(...args),
  },
}));

vi.mock("@sokosumi/utils", () => ({
  getOrganizationMetadata: () => ({ invoiceEmail: null }),
}));

vi.mock("@/lib/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: (...args: unknown[]) =>
      createOrganizationCustomerMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
    createCreditGrantInvoice: (...args: unknown[]) =>
      createCreditGrantInvoiceMock(...args),
    getBaseCreditTopUpPrice: (...args: unknown[]) =>
      getBaseCreditTopUpPriceMock(...args),
    getCreditTopUpPriceById: (...args: unknown[]) =>
      getCreditTopUpPriceByIdMock(...args),
    getInvoice: (...args: unknown[]) => getInvoiceMock(...args),
    payInvoiceOutOfBand: (...args: unknown[]) =>
      payInvoiceOutOfBandMock(...args),
    getAccountId: (...args: unknown[]) => getAccountIdMock(...args),
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
    creditBucket: {
      findFirst: (...args: unknown[]) => creditBucketFindFirstMock(...args),
    },
  },
}));

vi.mock("@/lib/stripe/credit-topup-pricing", () => ({
  isPositiveIntegerCredits: () => true,
  getCreditTopUpTotalMinorUnits: () => 1000,
}));

vi.mock("@/lib/stripe/webhook-handlers", () => ({
  handleInvoicePaidEvent: (...args: unknown[]) =>
    handleInvoicePaidEventMock(...args),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({ STRIPE_SUPPORT_COUPON: "coupon_support" }),
}));

import { creditGrantAdminService } from "../credit-grant-admin.service";

describe("creditGrantAdminService.createGrantInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBaseCreditTopUpPriceMock.mockResolvedValue({
      amountPerCredit: 100,
      currency: "usd",
    });
    createCreditGrantInvoiceMock.mockResolvedValue({
      id: "in_1",
      currency: "usd",
      amount_due: 1000,
      status: "open",
    });
    getAccountIdMock.mockResolvedValue("acct_1");
  });

  it("invoices the organization's Stripe customer for an organization target", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });

    const summary = await creditGrantAdminService.createGrantInvoice({
      target: { targetType: "organization", targetId: "org_1" },
      credits: 10,
      ttlDays: null,
      priceId: null,
      markFree: false,
    });

    expect(createCreditGrantInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_org", credits: 10 }),
    );
    expect(createCreditGrantInvoiceMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "couponId",
    );
    expect(createUserCustomerMock).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      targetType: "organization",
      targetId: "org_1",
      targetName: "Acme",
    });
  });

  it("invoices the user's Stripe customer for a user target", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user_1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      stripeCustomerId: "cus_user",
    });

    const summary = await creditGrantAdminService.createGrantInvoice({
      target: { targetType: "user", targetId: "user_1" },
      credits: 5,
      ttlDays: null,
      priceId: null,
      markFree: false,
    });

    expect(createCreditGrantInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_user", credits: 5 }),
    );
    expect(createOrganizationCustomerMock).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      targetType: "user",
      targetId: "user_1",
      targetName: "Ada Lovelace",
    });
  });

  it("applies the support coupon when the grant is marked free", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });

    await creditGrantAdminService.createGrantInvoice({
      target: { targetType: "organization", targetId: "org_1" },
      credits: 10,
      ttlDays: null,
      priceId: null,
      markFree: true,
    });

    expect(createCreditGrantInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ couponId: "coupon_support" }),
    );
  });

  it("grants credits immediately when the invoice finalizes as paid (free grant)", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });
    createCreditGrantInvoiceMock.mockResolvedValue({
      id: "in_free",
      currency: "usd",
      amount_due: 0,
      status: "paid",
    });
    creditBucketFindFirstMock.mockResolvedValue({ id: "cb_free" });

    const summary = await creditGrantAdminService.createGrantInvoice({
      target: { targetType: "organization", targetId: "org_1" },
      credits: 10,
      ttlDays: null,
      priceId: null,
      markFree: true,
    });

    expect(handleInvoicePaidEventMock).toHaveBeenCalledTimes(1);
    expect(creditBucketFindFirstMock).toHaveBeenCalled();
    expect(summary.targetType).toBe("organization");
  });
});

describe("creditGrantAdminService.markGrantInvoicePaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccountIdMock.mockResolvedValue("acct_1");
    handleInvoicePaidEventMock.mockResolvedValue(undefined);
    buildUserInvoiceCreditReferenceIdMock.mockReturnValue("user:ref");
    buildOrganizationInvoiceCreditReferenceIdMock.mockReturnValue("org:ref");
  });

  it("resolves a user customer first and verifies the user-scoped bucket", async () => {
    getInvoiceMock.mockResolvedValue({
      id: "in_1",
      metadata: { grant_source: "admin_one_time_credit", credits: "10" },
      customer: "cus_user",
      status: "paid",
      currency: "usd",
      amount_due: 1000,
    });
    getUserByStripeCustomerIdMock.mockResolvedValue({
      id: "user_1",
      name: "Ada Lovelace",
    });
    creditBucketFindFirstMock.mockResolvedValue({ id: "cb_1" });

    const summary = await creditGrantAdminService.markGrantInvoicePaid("in_1");

    expect(getOrganizationByStripeCustomerIdMock).not.toHaveBeenCalled();
    expect(payInvoiceOutOfBandMock).not.toHaveBeenCalled();
    expect(creditBucketFindFirstMock).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        organizationId: null,
        referenceId: "user:ref",
      },
      select: { id: true },
    });
    expect(summary).toMatchObject({
      targetType: "user",
      targetId: "user_1",
      targetName: "Ada Lovelace",
    });
  });

  it("falls back to organization resolution when no user owns the customer", async () => {
    getInvoiceMock.mockResolvedValue({
      id: "in_1",
      metadata: { grant_source: "admin_one_time_credit", credits: "10" },
      customer: "cus_org",
      status: "paid",
      currency: "usd",
      amount_due: 1000,
    });
    getUserByStripeCustomerIdMock.mockResolvedValue(null);
    getOrganizationByStripeCustomerIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
    });
    creditBucketFindFirstMock.mockResolvedValue({ id: "cb_1" });

    const summary = await creditGrantAdminService.markGrantInvoicePaid("in_1");

    expect(creditBucketFindFirstMock).toHaveBeenCalledWith({
      where: { organizationId: "org_1", referenceId: "org:ref" },
      select: { id: true },
    });
    expect(summary).toMatchObject({
      targetType: "organization",
      targetId: "org_1",
      targetName: "Acme",
    });
  });
});
