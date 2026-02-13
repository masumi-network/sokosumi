jest.mock("server-only", () => ({}));

const getUserByStripeCustomerIdMock = jest.fn();
const getOrganizationByStripeCustomerIdMock = jest.fn();
const getMembersByOrganizationIdMock = jest.fn();
const getSubscriptionCatalogMock = jest.fn();
const findExistingBucketMock = jest.fn();
const aggregateGrantedCreditsMock = jest.fn();
const createTransactionMock = jest.fn();
const findOutOfCreditsTasksMock = jest.fn();
const updateTaskMock = jest.fn();
const ensurePersonalFreeSubscriptionMock = jest.fn();
const ensureOrganizationFreeSubscriptionMock = jest.fn();
const claimWelcomeCouponMock = jest.fn();
const prismaOrganizationUpdateMock = jest.fn();
const prismaUserUpdateMock = jest.fn();

const transactionMock = jest.fn(async (callback: (tx: unknown) => unknown) =>
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
    getMembersByOrganizationId: (...args: unknown[]) =>
      getMembersByOrganizationIdMock(...args),
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
    creditBucket: {
      aggregate: (...args: unknown[]) => aggregateGrantedCreditsMock(...args),
    },
    organization: {
      update: (...args: unknown[]) => prismaOrganizationUpdateMock(...args),
    },
    user: {
      update: (...args: unknown[]) => prismaUserUpdateMock(...args),
    },
  },
}));

jest.mock("@/lib/services", () => ({
  stripeService: {
    ensurePersonalFreeSubscription: (...args: unknown[]) =>
      ensurePersonalFreeSubscriptionMock(...args),
    ensureOrganizationFreeSubscription: (...args: unknown[]) =>
      ensureOrganizationFreeSubscriptionMock(...args),
    claimWelcomeCoupon: (...args: unknown[]) => claimWelcomeCouponMock(...args),
  },
}));

jest.mock("@/lib/stripe/subscription-catalog", () => ({
  getSubscriptionCatalog: (...args: unknown[]) =>
    getSubscriptionCatalogMock(...args),
}));

const DEFAULT_PERIOD_END_UNIX = 1_735_689_600;
const DEFAULT_PERIOD_DURATION_SECONDS = 2_592_000;

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
    created: params.created ?? 1_735_689_600,
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
    jest.clearAllMocks();
    getUserByStripeCustomerIdMock.mockResolvedValue({
      id: "user-1",
    });
    getOrganizationByStripeCustomerIdMock.mockResolvedValue(null);
    getMembersByOrganizationIdMock.mockResolvedValue([
      { role: "owner", userId: "user-1" },
    ]);
    findExistingBucketMock.mockResolvedValue(null);
    aggregateGrantedCreditsMock.mockResolvedValue({
      _sum: { amount: null },
    });
    createTransactionMock.mockResolvedValue({});
    findOutOfCreditsTasksMock.mockResolvedValue([]);
    updateTaskMock.mockResolvedValue({});
  });

  it("does not grant subscription credits for unpaid subscription_update invoices", async () => {
    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

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

  it("grants free-plan seat credits for zero-amount subscription_update invoices", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "subscription_update",
        id: "in_free_sub_update",
        lines: [{ amount: 0, productId: "prod_free", quantity: 1 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        amount: bigint;
        sourceCreditBucket: {
          create: {
            referenceId: string;
            referenceType: string;
          };
        };
      };
    };

    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      "in_free_sub_update",
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(createCall.data.amount).toBe(BigInt("2500000000000"));
  });

  it("credits only the newly added free seats on subscription_update invoices", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });
    aggregateGrantedCreditsMock.mockResolvedValue({
      _sum: { amount: BigInt("2500000000000") },
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "subscription_update",
        id: "in_free_sub_update_incremental",
        lines: [{ amount: 0, productId: "prod_free", quantity: 2 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);

    const createCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        amount: bigint;
        sourceCreditBucket: {
          create: {
            referenceId: string;
            referenceType: string;
          };
        };
      };
    };

    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      "in_free_sub_update_incremental",
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(createCall.data.amount).toBe(BigInt("2500000000000"));
  });

  it("dedupes free organization subscription_update credits by organization period", async () => {
    getUserByStripeCustomerIdMock.mockResolvedValue(null);
    getOrganizationByStripeCustomerIdMock.mockResolvedValue({
      id: "org-1",
    });
    getMembersByOrganizationIdMock.mockResolvedValue([
      { role: "owner", userId: "owner-2" },
    ]);
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });
    aggregateGrantedCreditsMock.mockResolvedValue({
      _sum: { amount: BigInt("2500000000000") },
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    await handleInvoicePaidEvent(
      createInvoice({
        amountPaid: 0,
        billingReason: "subscription_update",
        id: "in_org_free_sub_update",
        lines: [{ amount: 0, productId: "prod_free", quantity: 2 }],
      }) as never,
    );

    expect(aggregateGrantedCreditsMock).toHaveBeenCalledTimes(1);
    const aggregateCall = aggregateGrantedCreditsMock.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(aggregateCall.where).toMatchObject({
      organizationId: "org-1",
      referenceType: "STRIPE_SUBSCRIPTION_PERIOD",
    });
    expect(aggregateCall.where).not.toHaveProperty("userId");

    expect(createTransactionMock).toHaveBeenCalledTimes(1);
    const createCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        amount: bigint;
        organization: {
          connect: {
            id: string;
          };
        };
      };
    };
    expect(createCall.data.organization.connect.id).toBe("org-1");
    expect(createCall.data.amount).toBe(BigInt("2500000000000"));
  });

  it("grants positive prorated credits for paid subscription_update invoices", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

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

    const createCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        sourceCreditBucket: {
          create: {
            amount: bigint;
            expiresAt: Date | null;
            referenceId: string;
            referenceType: string;
          };
        };
      };
    };

    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      "in_sub_upgrade",
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
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

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

    const createCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        amount: bigint;
        sourceCreditBucket: {
          create: {
            referenceId: string;
            referenceType: string;
          };
        };
      };
    };

    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      "in_sub_update_net",
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(createCall.data.amount).toBe(BigInt("52430000000000"));
  });

  it("fails paid subscription_update invoices when created timestamp is missing", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    const invoice = createInvoice({
      amountPaid: 1250,
      billingReason: "subscription_update",
      id: "in_sub_upgrade_missing_created",
      lines: [{ amount: 1250, productId: "prod_starter", quantity: 1 }],
    }) as Record<string, unknown>;
    delete invoice.created;

    await expect(handleInvoicePaidEvent(invoice as never)).rejects.toThrow(
      "Missing invoice created timestamp for upgrade invoice in_sub_upgrade_missing_created",
    );
  });

  it("fails paid subscription_update invoices when period duration is missing", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    await expect(
      handleInvoicePaidEvent(
        createInvoice({
          amountPaid: 1250,
          billingReason: "subscription_update",
          created: 1_735_689_600,
          id: "in_sub_upgrade_missing_duration",
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
      ),
    ).rejects.toThrow(
      "Missing subscription period duration for upgrade invoice in_sub_upgrade_missing_duration",
    );
  });

  it("grants subscription credits for subscription_cycle invoices", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
            referenceType: string;
          };
        };
      };
    };
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      "in_sub_cycle",
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

  it("uses invoice metadata credits for checkout-based top-up grants", async () => {
    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

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

    const createCall = createTransactionMock.mock.calls[0][0] as {
      data: {
        sourceCreditBucket: {
          create: {
            amount: bigint;
            referenceId: string;
            referenceType: string;
          };
        };
      };
    };
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      "in_topup_metadata",
    );
    expect(createCall.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_TOPUP",
    );
    expect(createCall.data.sourceCreditBucket.create.amount).toBe(
      BigInt("1230000000000"),
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
            referenceType: string;
          };
        };
      };
    };
    expect(createCall.data.sourceCreditBucket.create.referenceId).toBe(
      "in_topup",
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

  it("splits top-up and subscription credits into separate buckets when both are present", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
            referenceType: string;
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
            referenceType: string;
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
    expect(topupCall?.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_TOPUP",
    );
    expect(topupCall?.data.sourceCreditBucket.create.expiresAt).toBeNull();

    const subscriptionCall = callsByReference.get("in_mixed:subscription");
    expect(subscriptionCall).toBeDefined();
    expect(subscriptionCall?.data.amount).toBe(BigInt("17500000000000"));
    expect(subscriptionCall?.data.sourceCreditBucket.create.referenceType).toBe(
      "STRIPE_SUBSCRIPTION_PERIOD",
    );
    expect(subscriptionCall?.data.sourceCreditBucket.create.expiresAt).toEqual(
      new Date(1_735_689_600 * 1000),
    );
  });

  it("does not short-circuit split grants when a legacy combined top-up bucket exists", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });
    findExistingBucketMock.mockImplementation((args: unknown) => {
      const reference = (
        args as {
          where: {
            referenceId_referenceType: {
              referenceId: string;
              referenceType: string;
            };
          };
        }
      ).where.referenceId_referenceType;
      if (
        reference.referenceId === "in_mixed_legacy" &&
        reference.referenceType === "STRIPE_TOPUP"
      ) {
        return Promise.resolve({ id: "legacy-combined" });
      }

      return Promise.resolve(null);
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_mixed_legacy",
        lines: [
          { productId: "prod_credit", quantity: 3 },
          { productId: "prod_starter", quantity: 1, periodEnd: 1_735_689_600 },
        ],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(2);
    const lookedUpLegacyCombinedBucket = findExistingBucketMock.mock.calls.some(
      (call) => {
        const reference = (
          call[0] as {
            where: {
              referenceId_referenceType: {
                referenceId: string;
                referenceType: string;
              };
            };
          }
        ).where.referenceId_referenceType;

        return (
          reference.referenceId === "in_mixed_legacy" &&
          reference.referenceType === "STRIPE_TOPUP"
        );
      },
    );
    expect(lookedUpLegacyCombinedBucket).toBe(false);
  });

  it("does not look up top-up fallback when creating subscription-period buckets", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
    });
    findExistingBucketMock.mockImplementation((args: unknown) => {
      const reference = (
        args as {
          where: {
            referenceId_referenceType: {
              referenceId: string;
              referenceType: string;
            };
          };
        }
      ).where.referenceId_referenceType;
      if (
        reference.referenceId === "in_sub_cycle_legacy" &&
        reference.referenceType === "STRIPE_TOPUP"
      ) {
        return Promise.resolve({
          expiresAt: new Date(1_735_689_600 * 1000),
          id: "legacy-subscription",
        });
      }

      return Promise.resolve(null);
    });

    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    await handleInvoicePaidEvent(
      createInvoice({
        billingReason: "subscription_cycle",
        id: "in_sub_cycle_legacy",
        lines: [{ productId: "prod_starter", quantity: 1 }],
      }) as never,
    );

    expect(createTransactionMock).toHaveBeenCalledTimes(1);
    const lookedUpLegacyTopUpFallback = findExistingBucketMock.mock.calls.some(
      (call) => {
        const reference = (
          call[0] as {
            where: {
              referenceId_referenceType: {
                referenceId: string;
                referenceType: string;
              };
            };
          }
        ).where.referenceId_referenceType;

        return (
          reference.referenceId === "in_sub_cycle_legacy" &&
          reference.referenceType === "STRIPE_TOPUP"
        );
      },
    );
    expect(lookedUpLegacyTopUpFallback).toBe(false);
  });

  it("fails when subscription period end is missing", async () => {
    getSubscriptionCatalogMock.mockResolvedValue({
      free: { credits: 250, monthlyAmount: 0, productId: "prod_free" },
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
  it("creates CREDITS_TOPPED_UP events for tasks in OUT_OF_CREDITS when credits are granted", async () => {
    const { handleInvoicePaidEvent } = await import("../webhook-handlers");

    findOutOfCreditsTasksMock.mockResolvedValue([{ id: "task-1" }, { id: "task-2" }]);

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
        userId: "user-1",
      },
      select: {
        id: true,
      },
    });
    expect(updateTaskMock).toHaveBeenCalledTimes(2);
    expect(updateTaskMock).toHaveBeenNthCalledWith(1, {
      where: {
        id: "task-1",
      },
      data: {
        status: "CREDITS_TOPPED_UP",
        events: {
          create: {
            coworkerId: null,
            origin: "SOKOSUMI",
            status: "CREDITS_TOPPED_UP",
            userId: "user-1",
          },
        },
      },
    });
    expect(updateTaskMock).toHaveBeenNthCalledWith(2, {
      where: {
        id: "task-2",
      },
      data: {
        status: "CREDITS_TOPPED_UP",
        events: {
          create: {
            coworkerId: null,
            origin: "SOKOSUMI",
            status: "CREDITS_TOPPED_UP",
            userId: "user-1",
          },
        },
      },
    });
  });

});

describe("handleCustomerCreatedEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensurePersonalFreeSubscriptionMock.mockResolvedValue({
      status: "skipped",
      reason: "ALREADY_HAS_SUBSCRIPTION",
    });
    ensureOrganizationFreeSubscriptionMock.mockResolvedValue({
      status: "skipped",
      reason: "ALREADY_HAS_SUBSCRIPTION",
    });
    claimWelcomeCouponMock.mockResolvedValue({
      couponApplied: false,
      invoiceId: null,
    });
    prismaUserUpdateMock.mockResolvedValue(undefined);
    prismaOrganizationUpdateMock.mockResolvedValue(undefined);
  });

  it("ensures a free subscription for newly created organization customers", async () => {
    const { handleCustomerCreatedEvent } = await import("../webhook-handlers");

    await handleCustomerCreatedEvent({
      id: "cus_org_1",
      metadata: {
        customerType: "organization",
        organizationId: "org-1",
      },
    } as never);

    expect(prismaOrganizationUpdateMock).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { stripeCustomerId: "cus_org_1" },
    });
    expect(ensureOrganizationFreeSubscriptionMock).toHaveBeenCalledWith(
      "org-1",
    );
    expect(ensurePersonalFreeSubscriptionMock).not.toHaveBeenCalled();
  });

  it("keeps personal free subscription enrollment for user customers", async () => {
    const { handleCustomerCreatedEvent } = await import("../webhook-handlers");

    await handleCustomerCreatedEvent({
      id: "cus_user_1",
      metadata: {
        customerType: "user",
        userId: "user-1",
      },
    } as never);

    expect(prismaUserUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { stripeCustomerId: "cus_user_1" },
    });
    expect(ensurePersonalFreeSubscriptionMock).toHaveBeenCalledWith("user-1");
    expect(ensureOrganizationFreeSubscriptionMock).not.toHaveBeenCalled();
  });
});
