import { beforeEach, describe, expect, it, vi } from "vitest";

const getOrganizationWithRelationsByIdMock = vi.fn();
const getOrganizationByStripeCustomerIdMock = vi.fn();
const getUserByIdMock = vi.fn();
const getUserByStripeCustomerIdMock = vi.fn();

const createOrganizationCustomerMock = vi.fn();
const createUserCustomerMock = vi.fn();
const createAdminInvoiceMock = vi.fn();
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
const getUserBillingDetailsMock = vi.fn();
const getOrganizationBillingDetailsByIdMock = vi.fn();

const completeBillingDetails = {
  stripeCustomerId: "cus_test",
  email: "billing@example.com",
  address: {
    line1: "123 Main St",
    line2: null,
    city: "Berlin",
    state: null,
    postalCode: "10115",
    country: "DE",
  },
  taxIds: [],
};

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

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: (...args: unknown[]) =>
      createOrganizationCustomerMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
    createAdminInvoice: (...args: unknown[]) => createAdminInvoiceMock(...args),
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

vi.mock("@/services/stripe-invoice-credit.service", () => ({
  handleInvoicePaidEvent: (...args: unknown[]) =>
    handleInvoicePaidEventMock(...args),
}));

vi.mock("@/services/stripe-customer-billing.service", () => ({
  stripeCustomerBillingService: {
    getUserBillingDetails: (...args: unknown[]) =>
      getUserBillingDetailsMock(...args),
    getOrganizationBillingDetailsById: (...args: unknown[]) =>
      getOrganizationBillingDetailsByIdMock(...args),
  },
}));

import {
  InvoiceValidationError,
  invoiceAdminService,
} from "./invoice-admin.service";

describe("invoiceAdminService.createInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBaseCreditTopUpPriceMock.mockResolvedValue({
      id: "price_base",
      amountPerCredit: 100,
      currency: "usd",
    });
    createAdminInvoiceMock.mockResolvedValue({
      id: "in_1",
      currency: "usd",
      amount_due: 1000,
      status: "open",
    });
    getAccountIdMock.mockResolvedValue("acct_1");
    getUserBillingDetailsMock.mockResolvedValue(completeBillingDetails);
    getOrganizationBillingDetailsByIdMock.mockResolvedValue(
      completeBillingDetails,
    );
  });

  it("invoices the organization's Stripe customer for an organization target", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });

    const summary = await invoiceAdminService.createInvoice({
      target: { targetType: "organization", targetId: "org_1" },
      credits: 10,
      ttlDays: null,
      priceId: null,
    });

    expect(createAdminInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_org", credits: 10 }),
    );
    expect(createAdminInvoiceMock.mock.calls[0]?.[0]).not.toHaveProperty(
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

    const summary = await invoiceAdminService.createInvoice({
      target: { targetType: "user", targetId: "user_1" },
      credits: 5,
      ttlDays: null,
      priceId: null,
    });

    expect(createAdminInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_user", credits: 5 }),
    );
    expect(createOrganizationCustomerMock).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      targetType: "user",
      targetId: "user_1",
      targetName: "Ada Lovelace",
    });
  });

  it("creates a Stripe customer for a user target without one and stores the id", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user_1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      stripeCustomerId: null,
    });
    createUserCustomerMock.mockResolvedValue({ id: "cus_new" });
    userUpdateMock.mockResolvedValue({});

    await invoiceAdminService.createInvoice({
      target: { targetType: "user", targetId: "user_1" },
      credits: 5,
      ttlDays: null,
      priceId: null,
    });

    expect(createUserCustomerMock).toHaveBeenCalledWith({
      userId: "user_1",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { stripeCustomerId: "cus_new" },
    });
    expect(createAdminInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_new" }),
    );
  });

  it("does NOT grant immediately for an invoice that stays open", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });
    // Default mock returns status "open".
    await invoiceAdminService.createInvoice({
      target: { targetType: "organization", targetId: "org_1" },
      credits: 10,
      ttlDays: null,
      priceId: null,
    });

    expect(handleInvoicePaidEventMock).not.toHaveBeenCalled();
    expect(creditBucketFindFirstMock).not.toHaveBeenCalled();
  });

  it("throws when a grant rounds to a $0 total", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });
    // A tiny fractional price × small credit count can round to $0 at Stripe.
    createAdminInvoiceMock.mockResolvedValue({
      id: "in_zero",
      currency: "usd",
      amount_due: 0,
      status: "paid",
    });

    await expect(
      invoiceAdminService.createInvoice({
        target: { targetType: "organization", targetId: "org_1" },
        credits: 1,
        ttlDays: null,
        priceId: null,
      }),
    ).rejects.toThrow(InvoiceValidationError);
    // Must not silently grant free credits for a paid grant.
    expect(handleInvoicePaidEventMock).not.toHaveBeenCalled();
  });

  it("rejects non-positive-integer credits", async () => {
    await expect(
      invoiceAdminService.createInvoice({
        target: { targetType: "user", targetId: "user_1" },
        credits: 1.5,
        ttlDays: null,
        priceId: null,
      }),
    ).rejects.toThrow("Credits must be a positive integer");
  });

  it("rejects a ttlDays above the maximum", async () => {
    await expect(
      invoiceAdminService.createInvoice({
        target: { targetType: "user", targetId: "user_1" },
        credits: 10,
        ttlDays: 4000,
        priceId: null,
      }),
    ).rejects.toThrow("Expiry must be a positive integer of at most 3650 days");
  });

  it("rejects when the recipient has no billing address with country", async () => {
    getOrganizationWithRelationsByIdMock.mockResolvedValue({
      id: "org_1",
      name: "Acme",
      slug: "acme",
      stripeCustomerId: "cus_org",
      metadata: null,
    });
    getOrganizationBillingDetailsByIdMock.mockResolvedValue({
      stripeCustomerId: "cus_org",
      email: null,
      address: null,
      taxIds: [],
    });

    await expect(
      invoiceAdminService.createInvoice({
        target: { targetType: "organization", targetId: "org_1" },
        credits: 10,
        ttlDays: null,
        priceId: null,
      }),
    ).rejects.toThrow(
      "Recipient billing address with country is required for invoicing",
    );
    expect(createAdminInvoiceMock).not.toHaveBeenCalled();
  });

  it("rejects a user target when billing address has no country", async () => {
    getUserByIdMock.mockResolvedValue({
      id: "user_1",
      name: "Ada Lovelace",
      email: "ada@example.com",
      stripeCustomerId: "cus_user",
    });
    getUserBillingDetailsMock.mockResolvedValue({
      stripeCustomerId: "cus_user",
      email: "ada@example.com",
      address: null,
      taxIds: [],
    });

    await expect(
      invoiceAdminService.createInvoice({
        target: { targetType: "user", targetId: "user_1" },
        credits: 10,
        ttlDays: null,
        priceId: null,
      }),
    ).rejects.toThrow(
      "Recipient billing address with country is required for invoicing",
    );
    expect(createAdminInvoiceMock).not.toHaveBeenCalled();
  });
});

describe("invoiceAdminService.listInvoices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccountIdMock.mockResolvedValue("acct_1");
  });

  function getSearchQueries(): string[] {
    return searchInvoicesMock.mock.calls.map((call) => call[0]?.query ?? "");
  }

  it("runs one AND-only query per status (never mixing AND and OR), defaulting to unfinished", async () => {
    searchInvoicesMock.mockResolvedValue([]);

    await invoiceAdminService.listInvoices();

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

    await invoiceAdminService.listInvoices({ status: "all" });

    expect(searchInvoicesMock).toHaveBeenCalledTimes(1);
    const query = getSearchQueries()[0];
    expect(query).toContain('metadata["grant_source"]:"admin_one_time_credit"');
    expect(query).not.toContain("status:");
  });

  it("runs a single AND-only query when filtering by a specific status", async () => {
    searchInvoicesMock.mockResolvedValue([]);

    await invoiceAdminService.listInvoices({ status: "paid" });

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

    await invoiceAdminService.listInvoices({
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

    const items = await invoiceAdminService.listInvoices({
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

    const items = await invoiceAdminService.listInvoices({ limit: 2 });

    // The display limit is applied after sorting newest-first, not pushed down
    // to the Stripe search call — search has no guaranteed ordering, so the cap
    // must select the newest from the full set rather than the first page.
    expect(searchInvoicesMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2 }),
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.invoiceId)).toEqual(["in_4", "in_3"]);
  });

  it("returns only admin invoices, mapped and sorted newest first", async () => {
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

    const items = await invoiceAdminService.listInvoices();

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

    const items = await invoiceAdminService.listInvoices();

    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.targetType).toBeNull();
      expect(item.targetName).toBeNull();
    }
  });
});

describe("invoiceAdminService.getInvoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccountIdMock.mockResolvedValue("acct_1");
  });

  it("returns null when the invoice is not an admin invoice", async () => {
    getInvoiceMock.mockResolvedValue({
      id: "in_1",
      metadata: {},
      customer: "cus_user",
      status: "open",
      currency: "usd",
      amount_due: 1000,
    });

    const summary = await invoiceAdminService.getInvoice("in_1");

    expect(summary).toBeNull();
  });

  it("returns null when the invoice cannot be retrieved", async () => {
    getInvoiceMock.mockRejectedValue(new Error("No such invoice"));

    const summary = await invoiceAdminService.getInvoice("missing");

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

    const summary = await invoiceAdminService.getInvoice("in_1");

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

describe("invoiceAdminService.markInvoicePaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAccountIdMock.mockResolvedValue("acct_1");
    handleInvoicePaidEventMock.mockResolvedValue(undefined);
    buildUserInvoiceCreditReferenceIdMock.mockReturnValue("user:ref");
    buildOrganizationInvoiceCreditReferenceIdMock.mockReturnValue("org:ref");
  });

  it("returns null when the invoice cannot be retrieved", async () => {
    getInvoiceMock.mockRejectedValue(new Error("No such invoice"));

    const summary = await invoiceAdminService.markInvoicePaid("missing");

    expect(summary).toBeNull();
    expect(payInvoiceOutOfBandMock).not.toHaveBeenCalled();
    expect(handleInvoicePaidEventMock).not.toHaveBeenCalled();
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

    const summary = await invoiceAdminService.markInvoicePaid("in_1");

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

    const summary = await invoiceAdminService.markInvoicePaid("in_1");

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

  it("pays an open invoice out of band before granting", async () => {
    getInvoiceMock.mockResolvedValue({
      id: "in_1",
      metadata: { grant_source: "admin_one_time_credit", credits: "10" },
      customer: "cus_user",
      status: "open",
      currency: "usd",
      amount_due: 1000,
    });
    payInvoiceOutOfBandMock.mockResolvedValue({
      id: "in_1",
      metadata: { grant_source: "admin_one_time_credit", credits: "10" },
      customer: "cus_user",
      status: "paid",
      currency: "usd",
      amount_due: 1000,
    });
    getUserByStripeCustomerIdMock.mockResolvedValue({
      id: "user_1",
      name: "Ada",
    });
    creditBucketFindFirstMock.mockResolvedValue({ id: "cb_1" });

    const summary = await invoiceAdminService.markInvoicePaid("in_1");

    expect(payInvoiceOutOfBandMock).toHaveBeenCalledWith("in_1");
    expect(handleInvoicePaidEventMock).toHaveBeenCalledTimes(1);
    expect(summary?.status).toBe("paid");
  });

  it("rejects an invoice that is not an admin invoice", async () => {
    getInvoiceMock.mockResolvedValue({
      id: "in_1",
      metadata: {},
      customer: "cus_user",
      status: "open",
      currency: "usd",
      amount_due: 1000,
    });

    await expect(invoiceAdminService.markInvoicePaid("in_1")).rejects.toThrow(
      "Invoice is not an admin invoice",
    );

    expect(payInvoiceOutOfBandMock).not.toHaveBeenCalled();
  });
});
