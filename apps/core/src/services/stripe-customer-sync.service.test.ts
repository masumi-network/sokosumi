import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  organizationFindManyMock,
  organizationFindUniqueMock,
  pLimitMock,
  stripeConstructorMock,
  stripeCustomersCreateMock,
  userFindManyMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  pLimitMock: vi.fn(),
  stripeConstructorMock: vi.fn(),
  stripeCustomersCreateMock: vi.fn(),
  userFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("p-limit", () => ({
  default: pLimitMock,
}));

vi.mock("stripe", () => ({
  default: class StripeMock {
    customers = {
      create: stripeCustomersCreateMock,
    };

    constructor(secretKey: string, options?: unknown) {
      stripeConstructorMock(secretKey, options);
    }
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    STRIPE_SECRET_KEY: "sk_test_sync",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findMany: organizationFindManyMock,
      findUnique: organizationFindUniqueMock,
    },
    user: {
      findMany: userFindManyMock,
      findUnique: userFindUniqueMock,
    },
  },
}));

async function getStripeCustomerSyncService() {
  const module = await import("./stripe-customer-sync.service");
  return module.stripeCustomerSyncService;
}

interface SyncExecutionOptions {
  deadlineMs: number;
  msRemaining: () => number;
  shouldContinue: () => boolean;
}

function createSyncExecutionOptions(
  overrides: Partial<SyncExecutionOptions> = {},
): SyncExecutionOptions {
  const defaultDeadlineMs = Date.now() + 60_000;

  return {
    deadlineMs: defaultDeadlineMs,
    msRemaining: () => defaultDeadlineMs - Date.now(),
    shouldContinue: () => true,
    ...overrides,
  };
}

describe("stripeCustomerSyncService.syncAllStripeCustomers", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    pLimitMock.mockImplementation(() => (task: () => Promise<void>) => task());

    userFindManyMock.mockResolvedValue([{ id: "user-1" }, { id: "user-2" }]);
    organizationFindManyMock.mockResolvedValue([{ id: "organization-1" }]);

    userFindUniqueMock.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          email: `${where.id}@example.com`,
          id: where.id,
          name: `User ${where.id}`,
        }),
    );

    organizationFindUniqueMock.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve({
          id: where.id,
          invoiceEmail: `${where.id}@billing.example.com`,
          name: `Organization ${where.id}`,
          slug: `${where.id}-slug`,
        }),
    );
    stripeCustomersCreateMock.mockResolvedValue({});
  });

  it("uses p-limit with configured concurrency for users and organizations", async () => {
    const stripeCustomerSyncService = await getStripeCustomerSyncService();

    await stripeCustomerSyncService.syncAllStripeCustomers(
      createSyncExecutionOptions(),
    );

    expect(stripeConstructorMock).toHaveBeenCalledTimes(1);
    expect(stripeConstructorMock).toHaveBeenCalledWith("sk_test_sync", {
      maxNetworkRetries: 0,
    });
    expect(pLimitMock).toHaveBeenCalledTimes(1);
    expect(pLimitMock).toHaveBeenCalledWith(5);

    expect(stripeCustomersCreateMock).toHaveBeenCalledTimes(3);
    expect(stripeCustomersCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user-1@example.com",
        metadata: expect.objectContaining({
          customerType: "user",
          userId: "user-1",
        }),
      }),
      expect.objectContaining({
        idempotencyKey: "user-user-1",
        maxNetworkRetries: 0,
      }),
    );
    expect(stripeCustomersCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          customerType: "organization",
          organizationId: "organization-1",
          organizationSlug: "organization-1-slug",
        }),
        name: "Organization organization-1",
      }),
      expect.objectContaining({
        idempotencyKey: "organization-organization-1",
        maxNetworkRetries: 0,
      }),
    );
  });

  it("stops scheduling additional sync tasks after cancellation", async () => {
    const stripeCustomerSyncService = await getStripeCustomerSyncService();
    userFindManyMock.mockResolvedValue([
      { id: "user-1" },
      { id: "user-2" },
      { id: "user-3" },
    ]);
    organizationFindManyMock.mockResolvedValue([
      { id: "organization-1" },
      { id: "organization-2" },
    ]);

    let continueChecks = 0;
    const shouldContinue = vi.fn(() => {
      continueChecks += 1;
      return continueChecks <= 2;
    });

    await stripeCustomerSyncService.syncAllStripeCustomers(
      createSyncExecutionOptions({
        shouldContinue,
      }),
    );

    expect(stripeCustomersCreateMock).toHaveBeenCalledTimes(1);
    expect(stripeCustomersCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          customerType: "user",
          userId: "user-1",
        }),
      }),
      expect.objectContaining({
        idempotencyKey: "user-user-1",
      }),
    );
  });

  it("applies per-request timeout from remaining budget", async () => {
    vi.useFakeTimers();
    try {
      const stripeCustomerSyncService = await getStripeCustomerSyncService();
      const deadlineMs = Date.now() + 2500;

      const syncPromise = stripeCustomerSyncService.syncAllStripeCustomers({
        deadlineMs,
        msRemaining: () => Math.max(0, deadlineMs - Date.now()),
        shouldContinue: () => true,
      });

      await syncPromise;

      expect(stripeCustomersCreateMock).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          timeout: 2500,
          maxNetworkRetries: 0,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for already-scheduled operations to settle before returning", async () => {
    const stripeCustomerSyncService = await getStripeCustomerSyncService();
    userFindManyMock.mockResolvedValue([{ id: "user-1" }]);
    organizationFindManyMock.mockResolvedValue([{ id: "organization-1" }]);

    let resolveFirstCreate: (() => void) | null = null;
    stripeCustomersCreateMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstCreate = resolve;
          }),
      )
      .mockResolvedValueOnce({});

    let settled = false;
    const runPromise = stripeCustomerSyncService
      .syncAllStripeCustomers(createSyncExecutionOptions())
      .then(() => {
        settled = true;
      });

    await vi.waitFor(() => {
      expect(resolveFirstCreate).toBeTypeOf("function");
    });

    expect(settled).toBe(false);

    resolveFirstCreate?.();
    await runPromise;

    expect(settled).toBe(true);
    expect(stripeCustomersCreateMock).toHaveBeenCalledTimes(2);
    expect(stripeCustomersCreateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        metadata: expect.objectContaining({
          customerType: "user",
          userId: "user-1",
        }),
      }),
      expect.objectContaining({
        idempotencyKey: "user-user-1",
      }),
    );
    expect(stripeCustomersCreateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        metadata: expect.objectContaining({
          customerType: "organization",
          organizationId: "organization-1",
        }),
      }),
      expect.objectContaining({
        idempotencyKey: "organization-organization-1",
      }),
    );
  });
});
