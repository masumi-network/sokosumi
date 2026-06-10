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
const searchInvoicesMock = vi.fn();

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
    searchInvoices: (...args: unknown[]) => searchInvoicesMock(...args),
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

import {
  CreditGrantValidationError,
  creditGrantAdminService,
} from "../credit-grant-admin.service";

describe("creditGrantAdminService.createGrantInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBaseCreditTopUpPriceMock.mockResolvedValue({
      id: "price_base",
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
    createCreditGrantInvoiceMock.mockResolvedValue({
      id: "in_free",
      currency: "usd",
      amount_due: 0,
      status: "paid",
    });
    creditBucketFindFirstMock.mockResolvedValue({ id: "cb_free" });

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

  it("does NOT grant immediately for a non-free invoice that stays open", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });
    // Default mock returns status "open".
    await creditGrantAdminService.createGrantInvoice({
      target: { targetType: "organization", targetId: "org_1" },
      credits: 10,
      ttlDays: null,
      priceId: null,
      markFree: false,
    });

    expect(handleInvoicePaidEventMock).not.toHaveBeenCalled();
    expect(creditBucketFindFirstMock).not.toHaveBeenCalled();
  });

  it("throws when a free grant finalizes paid but no credits land", async () => {
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
    creditBucketFindFirstMock.mockResolvedValue(null);

    await expect(
      creditGrantAdminService.createGrantInvoice({
        target: { targetType: "organization", targetId: "org_1" },
        credits: 10,
        ttlDays: null,
        priceId: null,
        markFree: true,
      }),
    ).rejects.toThrow(CreditGrantValidationError);
  });

  it("throws when a free grant is not fully discounted to $0 (coupon misconfigured)", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });
    // Coupon didn't zero the invoice: it stays open with a balance due.
    createCreditGrantInvoiceMock.mockResolvedValue({
      id: "in_partial",
      currency: "usd",
      amount_due: 500,
      status: "open",
    });

    await expect(
      creditGrantAdminService.createGrantInvoice({
        target: { targetType: "organization", targetId: "org_1" },
        credits: 10,
        ttlDays: null,
        priceId: null,
        markFree: true,
      }),
    ).rejects.toThrow(CreditGrantValidationError);
    // No credits should be granted for a non-free "free" invoice.
    expect(handleInvoicePaidEventMock).not.toHaveBeenCalled();
  });

  it("throws when a non-free grant rounds to a $0 total", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });
    // A tiny fractional price × small credit count can round to $0 at Stripe.
    createCreditGrantInvoiceMock.mockResolvedValue({
      id: "in_zero",
      currency: "usd",
      amount_due: 0,
      status: "paid",
    });

    await expect(
      creditGrantAdminService.createGrantInvoice({
        target: { targetType: "organization", targetId: "org_1" },
        credits: 1,
        ttlDays: null,
        priceId: null,
        markFree: false,
      }),
    ).rejects.toThrow(CreditGrantValidationError);
    // Must not silently grant free credits for a paid grant.
    expect(handleInvoicePaidEventMock).not.toHaveBeenCalled();
  });
});

describe("creditGrantAdminService.listGrantInvoices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccountIdMock.mockResolvedValue("acct_1");
  });

  function getSearchQueries(): string[] {
    return searchInvoicesMock.mock.calls.map((call) => call[0]?.query ?? "");
  }

  it("runs one AND-only query per status (never mixing AND and OR), defaulting to unfinished", async () => {
    searchInvoicesMock.mockResolvedValue([]);

    await creditGrantAdminService.listGrantInvoices();

    const queries = getSearchQueries();
    expect(searchInvoicesMock).toHaveBeenCalledTimes(2);
    for (const query of queries) {
      expect(query).toContain(
        'metadata["grant_source"]:"admin_one_time_credit"',
      );
      // Stripe rejects a mix of AND and OR — each query must use AND only.
      expect(query).not.toContain(" OR ");
      expect(query).not.toContain("(");
      expect(query).not.toContain("customer:");
    }
    expect(queries.some((query) => query.includes('status:"draft"'))).toBe(
      true,
    );
    expect(queries.some((query) => query.includes('status:"open"'))).toBe(true);
  });

  it("runs a single status-less query when filtering by 'all'", async () => {
    searchInvoicesMock.mockResolvedValue([]);

    await creditGrantAdminService.listGrantInvoices({ status: "all" });

    expect(searchInvoicesMock).toHaveBeenCalledTimes(1);
    const query = getSearchQueries()[0];
    expect(query).toContain('metadata["grant_source"]:"admin_one_time_credit"');
    expect(query).not.toContain("status:");
  });

  it("runs a single AND-only query when filtering by a specific status", async () => {
    searchInvoicesMock.mockResolvedValue([]);

    await creditGrantAdminService.listGrantInvoices({ status: "paid" });

    expect(searchInvoicesMock).toHaveBeenCalledTimes(1);
    const query = getSearchQueries()[0];
    expect(query).toContain('status:"paid"');
    expect(query).not.toContain(" OR ");
  });

  it("scopes the search to the recipient's Stripe customer", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user_1",
      name: "Ada",
      stripeCustomerId: "cus_user",
    });
    searchInvoicesMock.mockResolvedValue([]);

    await creditGrantAdminService.listGrantInvoices({
      recipient: { targetType: "user", targetId: "user_1" },
    });

    for (const query of getSearchQueries()) {
      expect(query).toContain('customer:"cus_user"');
    }
  });

  it("returns an empty list when the recipient has no Stripe customer", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      stripeCustomerId: null,
    });

    const items = await creditGrantAdminService.listGrantInvoices({
      recipient: { targetType: "organization", targetId: "org_1" },
    });

    expect(items).toEqual([]);
    expect(searchInvoicesMock).not.toHaveBeenCalled();
  });

  it("caps the result at the requested limit", async () => {
    searchInvoicesMock.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `in_${index}`,
        status: "open",
        currency: "usd",
        amount_due: 1000,
        created: index,
        metadata: { grant_source: "admin_one_time_credit", credits: "1" },
        customer: { name: "Acme", metadata: { customerType: "organization" } },
      })),
    );

    const items = await creditGrantAdminService.listGrantInvoices({ limit: 2 });

    expect(searchInvoicesMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2 }),
    );
    expect(items).toHaveLength(2);
  });

  it("returns only admin credit-grant invoices, mapped and sorted newest first", async () => {
    searchInvoicesMock.mockResolvedValue([
      {
        id: "in_old",
        status: "open",
        currency: "usd",
        amount_due: 1000,
        created: 100,
        metadata: { grant_source: "admin_one_time_credit", credits: "10" },
        customer: {
          name: "Acme",
          metadata: { customerType: "organization" },
        },
      },
      {
        id: "in_other",
        status: "open",
        currency: "usd",
        amount_due: 2000,
        created: 200,
        // Not an admin grant invoice (e.g. a checkout invoice) — excluded.
        metadata: { credits: "5" },
        customer: { name: "Someone", metadata: { customerType: "user" } },
      },
      {
        id: "in_new",
        status: "draft",
        currency: "eur",
        amount_due: 500,
        created: 300,
        metadata: {
          grant_source: "admin_one_time_credit",
          credits: "3",
          ttl_days: "30",
        },
        customer: { name: "Ada", metadata: { customerType: "user" } },
      },
    ]);

    const items = await creditGrantAdminService.listGrantInvoices();

    expect(items.map((item) => item.invoiceId)).toEqual(["in_new", "in_old"]);
    expect(items[0]).toMatchObject({
      invoiceId: "in_new",
      targetType: "user",
      targetName: "Ada",
      credits: 3,
      ttlDays: 30,
      currency: "eur",
      amountDue: 500,
      status: "draft",
      createdAt: 300_000,
      dashboardUrl: "https://dashboard.stripe.com/acct_1/invoices/in_new",
    });
    expect(items[1]).toMatchObject({
      invoiceId: "in_old",
      targetType: "organization",
      targetName: "Acme",
      ttlDays: null,
    });
  });

  it("handles unexpanded or deleted customers without throwing", async () => {
    searchInvoicesMock.mockResolvedValue([
      {
        id: "in_str",
        status: "open",
        currency: "usd",
        amount_due: 1000,
        created: 100,
        metadata: { grant_source: "admin_one_time_credit", credits: "10" },
        customer: "cus_unexpanded",
      },
      {
        id: "in_deleted",
        status: "open",
        currency: "usd",
        amount_due: 1000,
        created: 50,
        metadata: { grant_source: "admin_one_time_credit", credits: "10" },
        customer: { deleted: true },
      },
    ]);

    const items = await creditGrantAdminService.listGrantInvoices();

    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.targetType).toBeNull();
      expect(item.targetName).toBeNull();
    }
  });
});

describe("creditGrantAdminService.getGrantInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccountIdMock.mockResolvedValue("acct_1");
  });

  it("returns null when the invoice is not an admin credit grant", async () => {
    getInvoiceMock.mockResolvedValue({
      id: "in_1",
      metadata: {},
      customer: "cus_user",
      status: "open",
      currency: "usd",
      amount_due: 1000,
    });

    const summary = await creditGrantAdminService.getGrantInvoice("in_1");

    expect(summary).toBeNull();
  });

  it("returns null when the invoice cannot be retrieved", async () => {
    getInvoiceMock.mockRejectedValue(new Error("No such invoice"));

    const summary = await creditGrantAdminService.getGrantInvoice("missing");

    expect(summary).toBeNull();
  });

  it("returns a summary resolving the user target", async () => {
    getInvoiceMock.mockResolvedValue({
      id: "in_1",
      metadata: {
        grant_source: "admin_one_time_credit",
        credits: "10",
        ttl_days: "30",
      },
      customer: "cus_user",
      status: "open",
      currency: "usd",
      amount_due: 1000,
    });
    getUserByStripeCustomerIdMock.mockResolvedValue({
      id: "user_1",
      name: "Ada",
    });

    const summary = await creditGrantAdminService.getGrantInvoice("in_1");

    expect(summary).toMatchObject({
      invoiceId: "in_1",
      targetType: "user",
      targetId: "user_1",
      targetName: "Ada",
      credits: 10,
      ttlDays: 30,
      status: "open",
      dashboardUrl: "https://dashboard.stripe.com/acct_1/invoices/in_1",
    });
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
