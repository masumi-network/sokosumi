import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectCoreLogWhys } from "@/test/core-log";

const {
  ensureInitialLocalFreeSubscriptionPeriodMock,
  prismaOrganizationUpdateMock,
  prismaUserUpdateMock,
  sentryCaptureExceptionMock,
} = vi.hoisted(() => ({
  ensureInitialLocalFreeSubscriptionPeriodMock: vi.fn(),
  prismaOrganizationUpdateMock: vi.fn(),
  prismaUserUpdateMock: vi.fn(),
  sentryCaptureExceptionMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ensureInitialLocalFreeSubscriptionPeriod:
    ensureInitialLocalFreeSubscriptionPeriodMock,
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => sentryCaptureExceptionMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) => callback({}),
    organization: {
      update: (...args: unknown[]) => prismaOrganizationUpdateMock(...args),
    },
    user: {
      update: (...args: unknown[]) => prismaUserUpdateMock(...args),
    },
  },
}));

async function getService() {
  return await import("./stripe-customer-created.service");
}

function prismaRecordNotFoundError(message: string): Error {
  return Object.assign(new Error(message), { code: "P2025" });
}

describe("handleCustomerCreatedEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureInitialLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);
    prismaUserUpdateMock.mockResolvedValue({
      createdAt: new Date("2026-04-09T07:03:48.591Z"),
      id: "user-1",
    });
    prismaOrganizationUpdateMock.mockResolvedValue({
      createdAt: new Date("2026-04-09T07:03:48.591Z"),
      id: "org-1",
    });
  });

  it("stores Stripe customer ids for newly created organization customers", async () => {
    const { handleCustomerCreatedEvent } = await getService();

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
    expect(ensureInitialLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        grantCredits: expect.any(Function),
        createdAt: new Date("2026-04-09T07:03:48.591Z"),
        kind: "organization",
        organizationId: "org-1",
        stripeCustomerId: "cus_org_1",
      },
      expect.anything(),
    );
  });

  it("stores Stripe customer ids for user customers without seeding a free plan", async () => {
    const { handleCustomerCreatedEvent } = await getService();

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
    expect(ensureInitialLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
  });

  it("ignores customers with an unknown customer type", async () => {
    const { handleCustomerCreatedEvent } = await getService();

    await handleCustomerCreatedEvent({
      id: "cus_other_1",
      metadata: { customerType: "something-else" },
    } as never);

    expect(prismaUserUpdateMock).not.toHaveBeenCalled();
    expect(prismaOrganizationUpdateMock).not.toHaveBeenCalled();
  });

  it("rethrows when the user write-back fails so Stripe retries the event", async () => {
    prismaUserUpdateMock.mockRejectedValue(new Error("user missing"));

    const { handleCustomerCreatedEvent } = await getService();

    await expect(
      handleCustomerCreatedEvent({
        id: "cus_user_1",
        metadata: {
          customerType: "user",
          userId: "user-1",
        },
      } as never),
    ).rejects.toThrow("user missing");
  });

  it("soft-acks organization write-back when the organization no longer exists", async () => {
    const missing = prismaRecordNotFoundError(
      "No record was found for an update.",
    );
    prismaOrganizationUpdateMock.mockRejectedValue(missing);
    const warnings = expectCoreLogWhys(
      "warn",
      "Skipped writing a Stripe customer id back to its owner",
      ["The organization no longer exists"],
    );

    const { handleCustomerCreatedEvent } = await getService();

    await expect(
      handleCustomerCreatedEvent({
        id: "cus_org_missing",
        metadata: {
          customerType: "organization",
          organizationId: "org-deleted",
        },
      } as never),
    ).resolves.toBeUndefined();

    expect(ensureInitialLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
    expect(warnings[0]?.event).toMatchObject({
      operation: "stripe_customer_created",
      stripeCustomer: { id: "cus_org_missing", customerType: "organization" },
      owner: { id: "org-deleted", type: "organization" },
    });
  });

  it("soft-acks user write-back when the user no longer exists", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Skipped writing a Stripe customer id back to its owner",
      ["The user no longer exists"],
    );
    const missing = prismaRecordNotFoundError(
      "No record was found for an update.",
    );
    prismaUserUpdateMock.mockRejectedValue(missing);

    const { handleCustomerCreatedEvent } = await getService();

    await expect(
      handleCustomerCreatedEvent({
        id: "cus_user_missing",
        metadata: {
          customerType: "user",
          userId: "user-deleted",
        },
      } as never),
    ).resolves.toBeUndefined();

    expect(ensureInitialLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
    expect(warnings[0]?.event).toMatchObject({
      stripeCustomer: { id: "cus_user_missing" },
      owner: { id: "user-deleted", type: "user" },
    });
  });

  it("skips organization write-back when organizationId metadata is missing", async () => {
    const warnings = expectCoreLogWhys(
      "warn",
      "Skipped writing a Stripe customer id back to its owner",
      ["The customer's metadata has no organizationId"],
    );

    const { handleCustomerCreatedEvent } = await getService();

    await handleCustomerCreatedEvent({
      id: "cus_org_no_meta",
      metadata: {
        customerType: "organization",
      },
    } as never);

    expect(prismaOrganizationUpdateMock).not.toHaveBeenCalled();
    expect(warnings[0]?.event).toMatchObject({
      stripeCustomer: { id: "cus_org_no_meta", customerType: "organization" },
    });
  });
});
