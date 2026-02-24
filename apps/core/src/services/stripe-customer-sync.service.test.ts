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

    constructor(secretKey: string) {
      stripeConstructorMock(secretKey);
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

    await stripeCustomerSyncService.syncAllStripeCustomers();

    expect(stripeConstructorMock).toHaveBeenCalledTimes(1);
    expect(stripeConstructorMock).toHaveBeenCalledWith("sk_test_sync");
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
      {
        idempotencyKey: "user-user-1",
      },
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
      {
        idempotencyKey: "organization-organization-1",
      },
    );
  });
});
