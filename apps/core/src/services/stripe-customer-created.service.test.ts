import { beforeEach, describe, expect, it, vi } from "vitest";

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
        createdAt: new Date("2026-04-09T07:03:48.591Z"),
        kind: "organization",
        organizationId: "org-1",
        stripeCustomerId: "cus_org_1",
      },
      expect.anything(),
    );
  });

  it("stores Stripe customer ids and seeds local free subscription for user customers", async () => {
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
    expect(ensureInitialLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        createdAt: new Date("2026-04-09T07:03:48.591Z"),
        kind: "user",
        stripeCustomerId: "cus_user_1",
        userId: "user-1",
      },
      expect.anything(),
    );
  });

  it("ignores customers with an unknown customer type", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const { handleCustomerCreatedEvent } = await getService();

      await handleCustomerCreatedEvent({
        id: "cus_other_1",
        metadata: { customerType: "something-else" },
      } as never);

      expect(prismaUserUpdateMock).not.toHaveBeenCalled();
      expect(prismaOrganizationUpdateMock).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Unknown customer type something-else",
      );
    } finally {
      consoleLogSpy.mockRestore();
    }
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
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    try {
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

      expect(
        ensureInitialLocalFreeSubscriptionPeriodMock,
      ).not.toHaveBeenCalled();
      expect(sentryCaptureExceptionMock).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Skipping Stripe customer cus_org_missing write-back: organization org-deleted no longer exists",
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it("soft-acks user write-back when the user no longer exists", async () => {
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
  });

  it("skips organization write-back when organizationId metadata is missing", async () => {
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    try {
      const { handleCustomerCreatedEvent } = await getService();

      await handleCustomerCreatedEvent({
        id: "cus_org_no_meta",
        metadata: {
          customerType: "organization",
        },
      } as never);

      expect(prismaOrganizationUpdateMock).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Skipping Stripe customer cus_org_no_meta write-back: missing organizationId metadata",
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});
