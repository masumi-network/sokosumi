import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createOrganizationCustomerMock,
  createUserCustomerMock,
  organizationFindManyMock,
  organizationFindUniqueMock,
  organizationUpdateMock,
  pLimitMock,
  userUpdateMock,
  userFindManyMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  createOrganizationCustomerMock: vi.fn(),
  createUserCustomerMock: vi.fn(),
  organizationFindManyMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  organizationUpdateMock: vi.fn(),
  pLimitMock: vi.fn(),
  userUpdateMock: vi.fn(),
  userFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("p-limit", () => ({
  default: pLimitMock,
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    createOrganizationCustomer: (...args: unknown[]) =>
      createOrganizationCustomerMock(...args),
    createUserCustomer: (...args: unknown[]) => createUserCustomerMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findMany: organizationFindManyMock,
      findUnique: organizationFindUniqueMock,
      update: organizationUpdateMock,
    },
    user: {
      findMany: userFindManyMock,
      findUnique: userFindUniqueMock,
      update: userUpdateMock,
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
    organizationFindManyMock.mockResolvedValue([{ id: "org-1" }]);

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
          metadata: null,
          name: `Organization ${where.id}`,
          slug: `${where.id}-slug`,
        }),
    );

    createUserCustomerMock.mockResolvedValue({ id: "cus_user" });
    createOrganizationCustomerMock.mockResolvedValue({ id: "cus_org" });
    userUpdateMock.mockResolvedValue(undefined);
    organizationUpdateMock.mockResolvedValue(undefined);
  });

  it("uses p-limit with configured concurrency for users and organizations", async () => {
    const stripeCustomerSyncService = await getStripeCustomerSyncService();

    await stripeCustomerSyncService.syncAllStripeCustomers(
      createSyncExecutionOptions(),
    );

    expect(pLimitMock).toHaveBeenCalledTimes(1);
    expect(pLimitMock).toHaveBeenCalledWith(5);

    expect(createUserCustomerMock).toHaveBeenCalledTimes(2);
    expect(createUserCustomerMock).toHaveBeenCalledWith(
      {
        email: "user-1@example.com",
        name: "User user-1",
        userId: "user-1",
      },
      {
        timeout: expect.any(Number),
      },
    );
    expect(createOrganizationCustomerMock).toHaveBeenCalledTimes(1);
    expect(createOrganizationCustomerMock).toHaveBeenCalledWith(
      {
        name: "Organization org-1",
        organizationId: "org-1",
        slug: "org-1-slug",
      },
      {
        timeout: expect.any(Number),
      },
    );
    expect(userUpdateMock).toHaveBeenCalledTimes(2);
    expect(userUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { stripeCustomerId: "cus_user" },
    });
    expect(organizationUpdateMock).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { stripeCustomerId: "cus_org" },
    });
  });

  it("stops scheduling additional sync tasks after cancellation", async () => {
    const stripeCustomerSyncService = await getStripeCustomerSyncService();
    userFindManyMock.mockResolvedValue([
      { id: "user-1" },
      { id: "user-2" },
      { id: "user-3" },
    ]);
    organizationFindManyMock.mockResolvedValue([]);

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

    expect(createUserCustomerMock).toHaveBeenCalledTimes(1);
    expect(createUserCustomerMock).toHaveBeenCalledWith(
      {
        email: "user-1@example.com",
        name: "User user-1",
        userId: "user-1",
      },
      {
        timeout: expect.any(Number),
      },
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

      expect(createUserCustomerMock).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          timeout: 2500,
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for already-scheduled operations to settle before returning", async () => {
    const stripeCustomerSyncService = await getStripeCustomerSyncService();
    userFindManyMock.mockResolvedValue([{ id: "user-1" }]);
    organizationFindManyMock.mockResolvedValue([]);

    let resolveFirstCreate: (() => void) | undefined;
    createUserCustomerMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstCreate = () => {
              resolve(undefined);
            };
          }),
      )
      .mockResolvedValueOnce({ id: "cus_user_2" });

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

    const resolve = resolveFirstCreate;
    if (!resolve) {
      throw new Error("Expected first create resolver to be assigned");
    }

    resolve();
    await runPromise;

    expect(settled).toBe(true);
    expect(createUserCustomerMock).toHaveBeenCalledTimes(1);
    expect(createUserCustomerMock).toHaveBeenNthCalledWith(
      1,
      {
        email: "user-1@example.com",
        name: "User user-1",
        userId: "user-1",
      },
      {
        timeout: expect.any(Number),
      },
    );
  });
});
