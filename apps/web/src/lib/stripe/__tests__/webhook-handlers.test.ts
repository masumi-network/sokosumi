jest.mock("server-only", () => ({}));

const getUserByStripeCustomerIdMock = jest.fn();
const getOrganizationByStripeCustomerIdMock = jest.fn();
const getSubscriptionCatalogMock = jest.fn();
const findExistingBucketMock = jest.fn();
const createTransactionMock = jest.fn();

const transactionMock = jest.fn(async (callback: (tx: unknown) => unknown) =>
  callback({
    creditBucket: {
      findUnique: (...args: unknown[]) => findExistingBucketMock(...args),
    },
    transaction: {
      create: (...args: unknown[]) => createTransactionMock(...args),
    },
  }),
);

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_CREDIT_PRODUCT_ID: "prod_credit",
    STRIPE_FREE_SUBSCRIPTION_PRODUCT_ID: "prod_free",
    STRIPE_PRO_SUBSCRIPTION_PRODUCT_ID: "prod_pro",
    STRIPE_SECRET_KEY: "sk_test_mock",
    STRIPE_STANDARD_SUBSCRIPTION_PRODUCT_ID: "prod_standard",
    STRIPE_STARTER_SUBSCRIPTION_PRODUCT_ID: "prod_starter",
  }),
}));

jest.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMembersByOrganizationId: jest.fn(),
  },
  organizationRepository: {
    getOrganizationByStripeCustomerId: (...args: unknown[]) =>
      getOrganizationByStripeCustomerIdMock(...args),
    getOrganizationWithRelationsById: jest.fn(),
    updateOrganizationInvoiceEmail: jest.fn(),
  },
  userRepository: {
    getUserByStripeCustomerId: (...args: unknown[]) =>
      getUserByStripeCustomerIdMock(...args),
  },
}));

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    organization: {
      update: jest.fn(),
    },
    user: {
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/services", () => ({
  stripeService: {
    ensurePersonalFreeSubscription: jest.fn(),
  },
}));

jest.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

function createInvoice(params: {
  billingReason:
    | "manual"
    | "subscription_create"
    | "subscription_cycle"
    | "subscription_update";
  id: string;
  lines: Array<{ periodEnd?: number | null; productId: string; quantity?: number }>;
}) {
  return {
    amount_paid: 1000,
    billing_reason: params.billingReason,
    customer: "cus_1",
    id: params.id,
    lines: {
      data: params.lines.map((line) => ({
        pricing: {
          price_details: {
            product: line.productId,
          },
        },
        quantity: line.quantity ?? 1,
        ...(line.periodEnd === null
          ? {}
          : {
              period: {
                end: line.periodEnd ?? 1_735_689_600,
                start: (line.periodEnd ?? 1_735_689_600) - 2_592_000,
              },
            }),
      })),
    },
  };
}

describe("handleInvoicePaidEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUserByStripeCustomerIdMock.mockResolvedValue({
      id: "user-1",
    });
    getOrganizationByStripeCustomerIdMock.mockResolvedValue(null);
    findExistingBucketMock.mockResolvedValue(null);
    createTransactionMock.mockResolvedValue({});
  });

  it("does not grant subscription credits for subscription_update invoices", async () => {
    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_update",
        id: "in_sub_update",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("grants subscription credits for subscription_cycle invoices", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, productId: "prod_free" },
      pro: { credits: 14000, productId: "prod_pro" },
      standard: { credits: 5250, productId: "prod_standard" },
      starter: { credits: 1750, productId: "prod_starter" },
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

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

    const createCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        sourceCreditBucket: {
          create: {
            amount: bigint;
            expiresAt: Date | null;
            referenceId: string;
          };
        };
      };
    };
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      "in_sub_cycle",
    );
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_735_689_600 * 1000),
    );
    // 1750 credits * quantity 2
    expect(createCall.data.sourceCreditBucket.create.amount).toBe(
      BigInt("35000000000000"),
    );
  });

  it("keeps one-time top-up crediting working regardless of billing reason", async () => {
    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "manual",
        id: "in_topup",
        lines: [{ productId: "prod_credit", quantity: 3 }],
      }) as never,
    );

    expect(getSubscriptionCatalogMock).not.toHaveBeenCalled();
    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        sourceCreditBucket: {
          create: {
            amount: bigint;
            expiresAt: Date | null;
            referenceId: string;
          };
        };
      };
    };
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe("in_topup");
    expect(createCall.data.sourceCreditBucket.create.expiresAt).toBeNull();
    // quantity-based top-up credits: 3 credits
    expect(createCall.data.sourceCreditBucket.create.amount).toBe(
      BigInt("30000000000"),
    );
  });

  it("splits top-up and subscription credits into separate buckets when both are present", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, productId: "prod_free" },
      pro: { credits: 14000, productId: "prod_pro" },
      standard: { credits: 5250, productId: "prod_standard" },
      starter: { credits: 1750, productId: "prod_starter" },
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

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

    const firstCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        amount: bigint;
        sourceCreditBucket: {
          create: {
            amount: bigint;
            expiresAt: Date | null;
            referenceId: string;
          };
        };
      };
    };
    const secondCall = createTransactionMock.mock.calls[1][0] as {
      data: {
        amount: bigint;
        sourceCreditBucket: {
          create: {
            amount: bigint;
            expiresAt: Date | null;
            referenceId: string;
          };
        };
      };
    };

    const callsByReference = new Map([
      [firstCall.data.sourceCreditBucket.create.referenceId, firstCall],
      [secondCall.data.sourceCreditBucket.create.referenceId, secondCall],
    ]);

    const topupCall = callsByReference.get("in_mixed:topup");
    expect(topupCall).toBeDefined();
    expect(topupCall?.data.amount).toBe(BigInt("30000000000"));
    expect(topupCall?.data.sourceCreditBucket.create.expiresAt).toBeNull();

    const subscriptionCall = callsByReference.get("in_mixed:subscription");
    expect(subscriptionCall).toBeDefined();
    expect(subscriptionCall?.data.amount).toBe(BigInt("17500000000000"));
    expect(subscriptionCall?.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_735_689_600 * 1000),
    );
  });

  it("fails when subscription period end is missing", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, productId: "prod_free" },
      pro: { credits: 14000, productId: "prod_pro" },
      standard: { credits: 5250, productId: "prod_standard" },
      starter: { credits: 1750, productId: "prod_starter" },
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

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
});
