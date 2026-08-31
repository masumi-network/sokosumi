import {
  buildOrganizationInvoiceCreditReferenceId,
  buildUserInvoiceCreditReferenceId,
  getCreditExpiryDate,
} from "@sokosumi/database/helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserByStripeCustomerIdMock = vi.fn();
const getOrganizationByStripeCustomerIdMock = vi.fn();
const resolveActiveSubscriptionByReferenceIdMock = vi.fn();
const getSubscriptionCatalogMock = vi.fn();
const findExistingBucketMock = vi.fn();
const findExistingOrganizationInvoiceSubscriptionBucketMock = vi.fn();
const createTransactionMock = vi.fn();
const findOutOfCreditsTasksMock = vi.fn();
const updateTaskMock = vi.fn();
const resolveOrganizationBillingPlanMock = vi.fn();

const transactionMock = vi.fn(async (callback: (tx: unknown) => unknown) =>
  callback({
    creditBucket: {
      findUnique: (...args: unknown[]) => findExistingBucketMock(...args),
    },
    transaction: {
      create: (...args: unknown[]) => createTransactionMock(...args),
    },
    task: {
      findMany: (...args: unknown[]) => findOutOfCreditsTasksMock(...args),
      update: (...args: unknown[]) => updateTaskMock(...args),
    },
  }),
);

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    STRIPE_CREDIT_PRODUCT_ID: "prod_credit",
    STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: "prod_pro",
    STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: "prod_standard",
    STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: "prod_starter",
  }),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    resolveOrganizationBillingPlan: (...args: unknown[]) =>
      resolveOrganizationBillingPlanMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  organizationRepository: {
    getOrganizationByStripeCustomerId: (...args: unknown[]) =>
      getOrganizationByStripeCustomerIdMock(...args),
  },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
  userRepository: {
    getUserByStripeCustomerId: (...args: unknown[]) =>
      getUserByStripeCustomerIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) =>
      transactionMock(callback),
    creditBucket: {
      findUnique: (...args: unknown[]) =>
        findExistingOrganizationInvoiceSubscriptionBucketMock(...args),
    },
  },
}));

vi.mock("@/services/subscription-catalog.service", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

const DEFAULT_PERIOD_END_UNIX = 1_735_689_600;
const DEFAULT_INVOICE_CREATED_UNIX = 1_735_689_600;
const DEFAULT_PERIOD_DURATION_SECONDS = 2_592_000;
const SUBSCRIPTION_CATALOG = {
  free: { credits: 250, monthlyAmount: 0, productId: "local-free" },
  pro: { credits: 14000, monthlyAmount: 20000, productId: "prod_pro" },
  standard: {
    credits: 5250,
    monthlyAmount: 7500,
    productId: "prod_standard",
  },
  starter: {
    credits: 1750,
    monthlyAmount: 2500,
    productId: "prod_starter",
  },
};

interface OrganizationMemberFixture {
  role: "member" | "owner";
  userId: string;
}

interface CreatedTransactionCall {
  data: {
    amount: bigint;
    sourceCreditBucket: {
      create: {
        amount?: bigint;
        expiresAt?: Date | null;
        referenceId: string;
        referenceType?: string;
        userId?: string | null;
      };
    };
    organization?: {
      connect: {
        id: string;
      };
    };
    organizationId?: string | null;
    user?: {
      connect: {
        id: string;
      };
    };
    userId?: string | null;
  };
}

function mockSubscriptionCatalog(): void {
  getSubscriptionCatalogMock.mockResolvedValue(SUBSCRIPTION_CATALOG);
}

function mockSelfServeOrganizationBillingPlan(
  plan: "free" | "pro" | "standard" | "starter" = "starter",
): void {
  resolveOrganizationBillingPlanMock.mockResolvedValue({
    mode: "self_serve",
    plan,
    purchasedSeats: 1,
    subscriptionId: "sub-org-1",
    cancelAtPeriodEnd: false,
    periodEnd: new Date("2026-03-01T00:00:00.000Z"),
  });
}

function mockOrganizationInvoiceContext(
  members: OrganizationMemberFixture[],
  organizationId = "org-1",
  assignedMemberUserIds?: string[],
): void {
  mockSelfServeOrganizationBillingPlan();
  getUserByStripeCustomerIdMock.mockResolvedValue(null);
  getOrganizationByStripeCustomerIdMock.mockResolvedValue({
    id: organizationId,
  });
  const assigned =
    assignedMemberUserIds ?? members.map((member) => member.userId).toSorted();
  resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
    seats: assigned.length || 1,
  });
}

function getTransactionCallsByReferenceId(): Map<
  string,
  CreatedTransactionCall
> {
  return new Map(
    createTransactionMock.mock.calls.map((call) => {
      const createCall = call[0] as CreatedTransactionCall;
      return [
        createCall.data.sourceCreditBucket.create.referenceId,
        createCall,
      ];
    }),
  );
}

function createInvoice(params: {
  amountPaid?: number;
  billingReason:
    | "manual"
    | "subscription_create"
    | "subscription_cycle"
    | "subscription_update";
  created?: number;
  id: string;
  metadata?: Record<string, string>;
  lines: Array<{
    amount?: number;
    periodStart?: number | null;
    periodEnd?: number | null;
    productId: string;
    quantity?: number;
  }>;
}) {
  return {
    amount_paid: params.amountPaid ?? 1000,
    billing_reason: params.billingReason,
    created: params.created ?? DEFAULT_INVOICE_CREATED_UNIX,
    customer: "cus_1",
    id: params.id,
    metadata: params.metadata ?? {},
    lines: {
      data: params.lines.map((line) => ({
        amount: line.amount ?? 1000,
        pricing: {
          price_details: {
            product: line.productId,
          },
        },
        quantity: line.quantity ?? 1,
        ...(line.periodEnd === null
          ? {}
          : (() => {
              const periodEnd = line.periodEnd ?? DEFAULT_PERIOD_END_UNIX;
              const period = {
                end: periodEnd,
                ...(line.periodStart === null
                  ? {}
                  : {
                      start:
                        line.periodStart ??
                        periodEnd - DEFAULT_PERIOD_DURATION_SECONDS,
                    }),
              };

              return { period };
            })()),
      })),
    },
  };
}

describe("handleInvoicePaidEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserByStripeCustomerIdMock.mockResolvedValue({
      id: "user-1",
    });
    getOrganizationByStripeCustomerIdMock.mockResolvedValue(null);
    findExistingBucketMock.mockResolvedValue(null);
    findExistingOrganizationInvoiceSubscriptionBucketMock.mockResolvedValue(
      null,
    );
    createTransactionMock.mockResolvedValue({});
    findOutOfCreditsTasksMock.mockResolvedValue([]);
    updateTaskMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws for an unknown Stripe customer so the webhook responds 5xx and Stripe retries", async () => {
    getUserByStripeCustomerIdMock.mockResolvedValue(null);
    getOrganizationByStripeCustomerIdMock.mockResolvedValue(null);

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await expect(
      handleInvoicePaidEvent(
        createInvoice({
          billingReason: "manual",
          id: "in_unknown_customer",
          lines: [{ productId: "prod_credit", quantity: 1 }],
          metadata: { credits: "100" },
        }) as never,
      ),
    ).rejects.toThrow(
      "Stripe customer cus_1 not found in our system for invoice in_unknown_customer",
    );

    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not grant subscription credits for unpaid subscription_update invoices", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "subscription_update",
        id: "in_sub_update",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not grant subscription credits for legacy Stripe free product lines on personal subscription_update", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "subscription_update",
        id: "in_legacy_free_personal",
        lines: [{ amount: 0, productId: "prod_free", quantity: 1 }],
      }) as never,
    );

    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("does not grant subscription credits for legacy Stripe free product lines on organization subscription_update", async () => {
    mockOrganizationInvoiceContext([
      { role: "member", userId: "member-1" },
      { role: "owner", userId: "owner-2" },
    ]);
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "subscription_update",
        id: "in_legacy_free_org",
        lines: [{ amount: 0, productId: "prod_free", quantity: 2 }],
      }) as never,
    );

    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("grants organization subscription cycle credits as one org-owned period bucket", async () => {
    mockOrganizationInvoiceContext([
      { role: "member", userId: "user-c" },
      { role: "owner", userId: "user-b" },
      { role: "member", userId: "user-a" },
    ]);
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_cycle_split",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const callsByReference = getTransactionCallsByReferenceId();
    const orgReferenceId = buildOrganizationInvoiceCreditReferenceId(
      "org-1",
      "in_org_cycle_split",
      "subscription",
    );
    const orgCall = callsByReference.get(orgReferenceId);

    expect(orgCall?.data.amount).toBe(BigInt("17500000000000"));
    expect(orgCall?.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(orgCall?.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_735_689_600 * 1000),
    );
    expect(orgCall?.data.organizationId).toBe("org-1");
    expect(orgCall?.data.userId).toBeNull();
    expect(orgCall?.data.user).toBeUndefined();
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
  });

  it("grants organization subscription cycle credits with no members", async () => {
    mockOrganizationInvoiceContext([]);
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_cycle_empty",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_cycle_empty",
        "subscription",
      ),
    );

    expect(orgCall?.data.organizationId).toBe("org-1");
    expect(orgCall?.data.userId).toBeNull();
    expect(orgCall?.data.user).toBeUndefined();
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
    expect(orgCall?.data.amount).toBe(BigInt("17500000000000"));
  });

  it("keeps organization invoice grants stable on retry when membership changes", async () => {
    mockOrganizationInvoiceContext([
      { role: "member", userId: "member-1" },
      { role: "owner", userId: "owner-2" },
      { role: "member", userId: "new-member-3" },
    ]);
    mockSubscriptionCatalog();
    findExistingOrganizationInvoiceSubscriptionBucketMock.mockResolvedValue({
      id: "existing-org-invoice-bucket",
    });

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_cycle_retry_membership_changed",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(
      findExistingOrganizationInvoiceSubscriptionBucketMock,
    ).toHaveBeenCalledWith({
      where: {
        referenceId_referenceType: {
          referenceId: buildOrganizationInvoiceCreditReferenceId(
            "org-1",
            "in_org_cycle_retry_membership_changed",
            "subscription",
          ),
          referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
        },
      },
      select: {
        id: true,
      },
    });
    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("keeps organization top-up grants shared", async () => {
    mockOrganizationInvoiceContext([
      { role: "member", userId: "member-1" },
      { role: "owner", userId: "owner-2" },
    ]);

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "manual",
        id: "in_org_topup",
        lines: [{ productId: "prod_credit", quantity: 1 }],
        metadata: { credits: "100" },
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);
    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.organizationId).toBe("org-1");
    expect(createCall.data.userId).toBeNull();
    expect(createCall.data.user).toBeUndefined();
    expect(createCall.data.amount).toBe(BigInt("1000000000000"));
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_topup",
        "topup",
      ),
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_TOPUP",
    );
    expect(createCall.data.sourceCreditBucket.create.userId).toBeNull();
  });

  it("grants paid organization proration credits as one org-owned period bucket", async () => {
    mockOrganizationInvoiceContext([
      { role: "member", userId: "member-1" },
      { role: "owner", userId: "owner-2" },
    ]);
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 1250,
        billingReason: "subscription_update",
        created: 1_735_689_600,
        id: "in_org_proration",
        lines: [
          {
            amount: 1250,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
            quantity: 1,
          },
        ],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_proration",
        "subscription",
      ),
    );

    expect(orgCall?.data.amount).toBe(BigInt("8750000000000"));
    expect(orgCall?.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
    expect(orgCall?.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_736_294_400 * 1000),
    );
  });

  it("does not cap organization proration credits to assigned member count", async () => {
    mockOrganizationInvoiceContext([
      { role: "member", userId: "member-1" },
      { role: "owner", userId: "owner-2" },
    ]);
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 1250,
        billingReason: "subscription_update",
        created: 1_735_689_600,
        id: "in_org_proration_capped",
        lines: [
          {
            amount: 1250,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
            quantity: 5,
          },
        ],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_proration_capped",
        "subscription",
      ),
    );

    expect(orgCall?.data.amount).toBe(BigInt("8750000000000"));
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
  });

  it("grants billed organization seats even when they exceed assigned members", async () => {
    mockOrganizationInvoiceContext(
      [
        { role: "member", userId: "member-1" },
        { role: "owner", userId: "owner-2" },
      ],
      "org-1",
      ["member-1"],
    );
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_cycle_cap_log",
        lines: [{ productId: "prod_starter", quantity: 5 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);
    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_cycle_cap_log",
        "subscription",
      ),
    );
    expect(orgCall?.data.amount).toBe(BigInt("87500000000000"));
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
  });

  it("uses purchased seats when the invoice line has no quantity", async () => {
    mockOrganizationInvoiceContext(
      [
        { role: "member", userId: "member-1" },
        { role: "owner", userId: "owner-2" },
      ],
      "org-1",
      ["member-1"],
    );
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({ seats: 5 });
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_cycle_default_quantity",
        lines: [{ productId: "prod_starter", quantity: 0 }],
      }) as never,
    );

    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_cycle_default_quantity",
        "subscription",
      ),
    );
    expect(orgCall?.data.amount).toBe(BigInt("87500000000000"));
  });

  it("grants billed organization seats into the pool when no seats are assigned", async () => {
    mockOrganizationInvoiceContext(
      [
        { role: "member", userId: "member-1" },
        { role: "owner", userId: "owner-2" },
      ],
      "org-1",
      [],
    );
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_no_assigned_seats",
        lines: [{ productId: "prod_starter", quantity: 5 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);
    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_no_assigned_seats",
        "subscription",
      ),
    );
    expect(orgCall?.data.amount).toBe(BigInt("87500000000000"));
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
  });

  it("skips unassigned free credits while an enterprise contract is consumable", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockOrganizationInvoiceContext(
      [
        { role: "member", userId: "member-1" },
        { role: "owner", userId: "owner-2" },
      ],
      "org-1",
      [],
    );
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      contractId: "contract-1",
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      isConsumable: true,
      mode: "enterprise_contract",
      periodEnd: null,
      plan: "enterprise",
      purchasedSeats: 5,
    });
    mockSubscriptionCatalog();
    vi.setSystemTime(new Date(1_733_011_200 * 1000));

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    try {
      await handleInvoicePaidEvent(
        createInvoice({
          billingReason: "subscription_cycle",
          id: "in_org_enterprise_consumable",
          lines: [{ productId: "prod_starter", quantity: 5 }],
        }) as never,
      );

      expect(createTransactionMock).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Invoice in_org_enterprise_consumable has no grantable credits",
        ),
      );
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("grants Stripe period credits to the org pool for post-term enterprise contracts", async () => {
    mockOrganizationInvoiceContext(
      [
        { role: "member", userId: "member-1" },
        { role: "owner", userId: "owner-2" },
      ],
      "org-1",
      [],
    );
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      activatedAt: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      contractId: "contract-1",
      endsAt: new Date("2026-02-01T00:00:00.000Z"),
      isConsumable: false,
      mode: "enterprise_contract",
      periodEnd: null,
      plan: "enterprise",
      purchasedSeats: 5,
    });
    mockSubscriptionCatalog();
    vi.setSystemTime(new Date(1_733_011_200 * 1000));

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_enterprise_post_term",
        lines: [{ productId: "prod_starter", quantity: 5 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);
    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_enterprise_post_term",
        "subscription",
      ),
    );
    expect(orgCall?.data.amount).toBe(BigInt("87500000000000"));
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
  });

  it("grants organization proration into the pool when no seats are assigned", async () => {
    mockOrganizationInvoiceContext(
      [
        { role: "member", userId: "member-1" },
        { role: "owner", userId: "owner-2" },
      ],
      "org-1",
      [],
    );
    mockSubscriptionCatalog();
    vi.setSystemTime(new Date(1_733_011_200 * 1000));

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 1250,
        billingReason: "subscription_update",
        created: 1_735_689_600,
        id: "in_org_update_no_assigned",
        lines: [
          {
            amount: 1250,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
          },
        ],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_update_no_assigned",
        "subscription",
      ),
    );
    expect(orgCall?.data.amount).toBe(BigInt("8750000000000"));
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
  });

  it("does not mint an org-owned invoice grant when the org invoice sentinel fingerprint exists", async () => {
    mockOrganizationInvoiceContext([{ role: "owner", userId: "owner-1" }]);
    mockSubscriptionCatalog();
    findExistingOrganizationInvoiceSubscriptionBucketMock.mockResolvedValue({
      id: "org-invoice-sentinel",
    });
    vi.setSystemTime(new Date(1_733_011_200 * 1000));

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_1Abc_sentinel",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(createTransactionMock).not.toHaveBeenCalled();
    expect(
      findExistingOrganizationInvoiceSubscriptionBucketMock,
    ).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        referenceId_referenceType: {
          referenceId: buildOrganizationInvoiceCreditReferenceId(
            "org-1",
            "in_1Abc_sentinel",
            "subscription",
          ),
          referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
        },
      },
    });
  });

  it("grants paid organization credits to the pool without a free-tier sidecar for unassigned members", async () => {
    mockOrganizationInvoiceContext(
      [
        { role: "owner", userId: "assigned-1" },
        { role: "member", userId: "unassigned-2" },
      ],
      "org-1",
      ["assigned-1"],
    );
    mockSubscriptionCatalog();
    vi.setSystemTime(new Date(1_733_011_200 * 1000));

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_mixed_seats",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const orgCall = getTransactionCallsByReferenceId().get(
      buildOrganizationInvoiceCreditReferenceId(
        "org-1",
        "in_org_mixed_seats",
        "subscription",
      ),
    );
    expect(orgCall?.data.amount).toBe(BigInt("17500000000000"));
    expect(orgCall?.data.sourceCreditBucket.create.userId).toBeNull();
  });

  it("does not mint a free-tier sidecar for unassigned members on a paid invoice", async () => {
    mockOrganizationInvoiceContext(
      [
        { role: "owner", userId: "owner-1" },
        { role: "member", userId: "member-1" },
      ],
      "org-1",
      ["owner-1"],
    );
    mockSubscriptionCatalog();
    vi.setSystemTime(new Date(1_733_011_200 * 1000));

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_org_free_idempotent",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);
    expect(
      getTransactionCallsByReferenceId().get(
        buildOrganizationInvoiceCreditReferenceId(
          "org-1",
          "in_org_free_idempotent",
          "subscription",
        ),
      )?.data.sourceCreditBucket.create.userId,
    ).toBeNull();
  });

  it("grants positive prorated credits for paid subscription_update invoices", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 1250,
        billingReason: "subscription_update",
        created: 1_735_689_600,
        id: "in_sub_upgrade",
        lines: [
          {
            amount: 1250,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
            quantity: 1,
          },
        ],
      }) as never,
    );

    expect(getSubscriptionCatalogMock).toHaveBeenCalledTimes(1);
    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      buildUserInvoiceCreditReferenceId(
        "user-1",
        "in_sub_upgrade",
        "subscription",
      ),
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_736_294_400 * 1000),
    );
    expect(createCall.data.sourceCreditBucket.create.amount).toBe(
      BigInt("8750000000000"),
    );
  });

  it("uses net proration amount for subscription_update invoices with negative lines", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 7491,
        billingReason: "subscription_update",
        created: 1_735_689_600,
        id: "in_sub_update_net",
        lines: [
          {
            amount: 7491,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
            quantity: 3,
          },
          {
            amount: 7491,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
            quantity: 3,
          },
          {
            amount: 7491,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
            quantity: 3,
          },
          {
            amount: -7491,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
            quantity: 3,
          },
          {
            amount: -7491,
            periodEnd: 1_736_294_400,
            periodStart: 1_735_689_600,
            productId: "prod_starter",
            quantity: 3,
          },
        ],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      buildUserInvoiceCreditReferenceId(
        "user-1",
        "in_sub_update_net",
        "subscription",
      ),
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(createCall.data.amount).toBe(BigInt("52430000000000"));
  });

  it("uses period end for paid subscription_update invoices when created timestamp is missing", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    const invoice = createInvoice({
      amountPaid: 1250,
      billingReason: "subscription_update",
      id: "in_sub_upgrade_missing_created",
      lines: [{ amount: 1250, productId: "prod_starter", quantity: 1 }],
    }) as Record<string, unknown>;
    delete invoice.created;

    await handleInvoicePaidEvent(invoice as never);

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(DEFAULT_PERIOD_END_UNIX * 1000),
    );
  });

  it("uses period end for paid subscription_update invoices when period start is missing", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 1250,
        billingReason: "subscription_update",
        created: 1_735_689_600,
        id: "in_sub_upgrade_missing_period_start",
        lines: [
          {
            amount: 1250,
            periodEnd: 1_735_689_600,
            periodStart: null,
            productId: "prod_starter",
            quantity: 1,
          },
        ],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_735_689_600 * 1000),
    );
  });

  it("grants subscription credits for subscription_cycle invoices", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_sub_cycle",
        lines: [{ productId: "prod_starter", quantity: 2 }],
      }) as never,
    );

    expect(getSubscriptionCatalogMock).toHaveBeenCalledTimes(1);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      buildUserInvoiceCreditReferenceId(
        "user-1",
        "in_sub_cycle",
        "subscription",
      ),
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_735_689_600 * 1000),
    );
    // 1750 credits * quantity 2
    expect(createCall.data.sourceCreditBucket.create.amount).toBe(
      BigInt("35000000000000"),
    );
  });

  it("skips unknown subscription products and grants credits for known lines", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_mixed_unknown_and_starter",
        lines: [
          { productId: "prod_unknown", quantity: 1 },
          { productId: "prod_starter", quantity: 1 },
        ],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;
    expect(createCall.data.sourceCreditBucket.create.amount).toBe(
      BigInt("17500000000000"),
    );
  });

  it("uses invoice metadata credits for checkout-based top-up grants", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "manual",
        id: "in_topup_metadata",
        lines: [{ productId: "prod_credit", quantity: 1 }],
        metadata: { credits: "123" },
      }) as never,
    );

    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      buildUserInvoiceCreditReferenceId("user-1", "in_topup_metadata", "topup"),
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_TOPUP",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toBeNull();
    expect(createCall.data.sourceCreditBucket.create.amount).toBe(
      BigInt("1230000000000"),
    );
  });

  it("keeps one-time top-up crediting working regardless of billing reason", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "manual",
        id: "in_topup",
        lines: [{ productId: "prod_credit", quantity: 3 }],
      }) as never,
    );

    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      buildUserInvoiceCreditReferenceId("user-1", "in_topup", "topup"),
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_TOPUP",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toBeNull();
    // quantity-based top-up credits: quantity 3 => 3 credits
    expect(createCall.data.sourceCreditBucket.create.amount).toBe(
      BigInt("30000000000"),
    );
  });

  it("classifies free top-up invoices as STRIPE_FREE with no expiry when ttl_days is omitted", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "manual",
        id: "in_topup_free_coupon",
        lines: [{ productId: "prod_credit", quantity: 3 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_FREE",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toBeNull();
  });

  it("uses ttl_days invoice metadata for free top-up expiry", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "manual",
        id: "in_topup_free_coupon_ttl_90",
        lines: [{ productId: "prod_credit", quantity: 3 }],
        metadata: { ttl_days: "90" },
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_FREE",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toEqual(
      getCreditExpiryDate(new Date(DEFAULT_PERIOD_END_UNIX * 1000), 90),
    );
  });

  it("applies ttl_days expiry to paid (non-zero) top-ups while keeping STRIPE_TOPUP", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 5000,
        billingReason: "manual",
        id: "in_admin_grant_paid_ttl_30",
        lines: [{ productId: "prod_credit", quantity: 1 }],
        metadata: { credits: "500", ttl_days: "30" },
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_TOPUP",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toEqual(
      getCreditExpiryDate(new Date(DEFAULT_INVOICE_CREATED_UNIX * 1000), 30),
    );
  });

  it("sets no expiry for free top-up when ttl_days is 0", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "manual",
        id: "in_topup_free_coupon_ttl_0",
        lines: [{ productId: "prod_credit", quantity: 3 }],
        metadata: { ttl_days: "0" },
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_FREE",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toBeNull();
  });

  it("sets no expiry for free top-up when ttl_days metadata is invalid", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "manual",
        id: "in_topup_free_coupon_ttl_invalid",
        lines: [{ productId: "prod_credit", quantity: 3 }],
        metadata: { ttl_days: "null" },
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock
      .calls[0][0] as CreatedTransactionCall;

    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_FREE",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toBeNull();
  });

  it("splits top-up and subscription credits into separate buckets when both are present", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_mixed",
        lines: [
          { productId: "prod_credit", quantity: 3 },
          { productId: "prod_starter", quantity: 1, periodEnd: 1_735_689_600 },
        ],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(2);

    const callsByReference = getTransactionCallsByReferenceId();

    const topupCall = callsByReference.get(
      buildUserInvoiceCreditReferenceId("user-1", "in_mixed", "topup"),
    );
    expect(topupCall).toBeDefined();
    expect(topupCall?.data.amount).toBe(BigInt("30000000000"));
    expect(topupCall?.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_TOPUP",
    );
    expect(topupCall?.data.sourceCreditBucket.create.expiresAt).toBeNull();

    const subscriptionCall = callsByReference.get(
      buildUserInvoiceCreditReferenceId("user-1", "in_mixed", "subscription"),
    );
    expect(subscriptionCall).toBeDefined();
    expect(subscriptionCall?.data.amount).toBe(BigInt("17500000000000"));
    expect(subscriptionCall?.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(subscriptionCall?.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_735_689_600 * 1000),
    );
  });

  it("fails when subscription period end is missing", async () => {
    mockSubscriptionCatalog();

    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    await expect(
      handleInvoicePaidEvent(
        createInvoice({
          billingReason: "subscription_cycle",
          id: "in_missing_period",
          lines: [{ productId: "prod_starter", quantity: 1, periodEnd: null }],
        }) as never,
      ),
    ).rejects.toThrow(
      "Missing subscription period end for invoice in_missing_period",
    );

    expect(createTransactionMock).not.toHaveBeenCalled();
  });

  it("creates CREDITS_TOPPED_UP events for tasks in OUT_OF_CREDITS when credits are granted", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    findOutOfCreditsTasksMock.mockResolvedValue([
      { id: "task-1" },
      { id: "task-2" },
    ]);

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "manual",
        id: "in_topup_with_tasks",
        metadata: { credits: "2" },
        lines: [{ productId: "prod_credit", quantity: 2 }],
      }) as never,
    );

    expect(findOutOfCreditsTasksMock).toHaveBeenCalledWith({
      where: {
        status: "OUT_OF_CREDITS",
        ownerId: "user-1",
      },
      select: {
        id: true,
      },
    });
    expect(updateTaskMock).toHaveBeenCalledTimes(2);
    expect(updateTaskMock).toHaveBeenNthCalledWith(1, {
      where: {
        id: "task-1",
        status: "OUT_OF_CREDITS",
      },
      data: {
        status: "CREDITS_TOPPED_UP",
        events: {
          create: {
            coworkerId: null,
            channel: "SOKOSUMI",
            status: "CREDITS_TOPPED_UP",
            userId: "user-1",
          },
        },
      },
    });
    expect(updateTaskMock).toHaveBeenNthCalledWith(2, {
      where: {
        id: "task-2",
        status: "OUT_OF_CREDITS",
      },
      data: {
        status: "CREDITS_TOPPED_UP",
        events: {
          create: {
            coworkerId: null,
            channel: "SOKOSUMI",
            status: "CREDITS_TOPPED_UP",
            userId: "user-1",
          },
        },
      },
    });
  });

  it("does not roll back granted credits when a task is updated concurrently", async () => {
    const { handleInvoicePaidEvent } = await import(
      "./stripe-invoice-credit.service"
    );

    findOutOfCreditsTasksMock.mockResolvedValue([
      { id: "task-1" },
      { id: "task-2" },
    ]);
    updateTaskMock
      .mockRejectedValueOnce({ code: "P2025" })
      .mockResolvedValueOnce({});

    await expect(
      handleInvoicePaidEvent(
        createInvoice({
          billingReason: "manual",
          id: "in_topup_with_task_race",
          metadata: { credits: "2" },
          lines: [{ productId: "prod_credit", quantity: 2 }],
        }) as never,
      ),
    ).resolves.toBeUndefined();

    expect(createTransactionMock).toHaveBeenCalledTimes(1);
    expect(updateTaskMock).toHaveBeenCalledTimes(2);
  });
});
