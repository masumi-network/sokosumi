import { NotificationKind } from "@sokosumi/database";
import {
  BILLING_CREDITS_ADDED_MESSAGE_KEY,
  BILLING_LOW_BALANCE_MESSAGE_KEY,
  BILLING_PAYMENT_FAILED_MESSAGE_KEY,
  BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
  convertCreditsToCents,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  createNotificationMock,
  getBalanceMock,
  getOrganizationByStripeCustomerIdMock,
  getUserByStripeCustomerIdMock,
  markAttentionReadMock,
  prismaCreditBucketFindFirstMock,
  prismaMemberFindManyMock,
  prismaWorkspaceFindUniqueMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  createNotificationMock: vi.fn(),
  getBalanceMock: vi.fn(),
  getOrganizationByStripeCustomerIdMock: vi.fn(),
  getUserByStripeCustomerIdMock: vi.fn(),
  markAttentionReadMock: vi.fn(),
  prismaCreditBucketFindFirstMock: vi.fn(),
  prismaMemberFindManyMock: vi.fn(),
  prismaWorkspaceFindUniqueMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    getBalance: (...args: unknown[]) => getBalanceMock(...args),
  },
  organizationRepository: {
    getOrganizationByStripeCustomerId: (...args: unknown[]) =>
      getOrganizationByStripeCustomerIdMock(...args),
  },
  userRepository: {
    getUserByStripeCustomerId: (...args: unknown[]) =>
      getUserByStripeCustomerIdMock(...args),
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ LOW_CREDITS_THRESHOLD: 100 }),
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}));

vi.mock("@/helpers/notification-read", () => ({
  markAttentionRead: (...args: unknown[]) => markAttentionReadMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    creditBucket: {
      findFirst: (...args: unknown[]) =>
        prismaCreditBucketFindFirstMock(...args),
    },
    member: {
      findMany: (...args: unknown[]) => prismaMemberFindManyMock(...args),
    },
    workspace: {
      findUnique: (...args: unknown[]) =>
        prismaWorkspaceFindUniqueMock(...args),
    },
  },
}));

import {
  notifyInvoicePaid,
  notifyLowBalanceAfterCharge,
  notifyPaymentFailed,
  notifySubscriptionEnding,
  resolveBillingWalletByStripeCustomerId,
} from "./billing-notifications";
import { BILLING_ATTENTION_MESSAGE_KEYS } from "./notification-delivery";

const PERSONAL = { userId: "user-1", organizationId: null };
const ORGANIZATION = { userId: "member-1", organizationId: "org-1" };

describe("notifyLowBalanceAfterCharge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaWorkspaceFindUniqueMock.mockResolvedValue({ id: "ws-1" });
    prismaCreditBucketFindFirstMock.mockResolvedValue({ id: "bucket-9" });
    prismaMemberFindManyMock.mockResolvedValue([
      { userId: "owner-1" },
      { userId: "admin-1" },
    ]);
    createNotificationMock.mockResolvedValue({ created: true });
  });

  it("tells the owner of a personal wallet that ran under the threshold", async () => {
    getBalanceMock.mockResolvedValue(convertCreditsToCents(42.7));

    await notifyLowBalanceAfterCharge(PERSONAL);

    expect(getBalanceMock).toHaveBeenCalledWith(
      "user-1",
      null,
      expect.anything(),
    );
    expect(prismaWorkspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: { id: true },
    });
    // The user's own buckets, not a seat they hold in some organization.
    expect(prismaCreditBucketFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          organizationId: null,
        }),
      }),
    );
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: "user-1",
      kind: NotificationKind.BILLING,
      referenceId: "user-1",
      eventId: "low-balance:bucket-9",
      messageKey: BILLING_LOW_BALANCE_MESSAGE_KEY,
      messageParams: { credits: 42 },
      metadata: { workspaceId: "ws-1", organizationId: null },
    });
  });

  it("says nothing while the balance is at or above the threshold", async () => {
    getBalanceMock.mockResolvedValue(convertCreditsToCents(100));

    await notifyLowBalanceAfterCharge(PERSONAL);

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  /**
   * The two reads are not one snapshot. A top-up that lands between them must
   * lift the balance this run sees, not become the bucket this run keys on.
   */
  it("reads the bucket before the balance", async () => {
    getBalanceMock.mockResolvedValue(convertCreditsToCents(1));

    await notifyLowBalanceAfterCharge(PERSONAL);

    expect(
      prismaCreditBucketFindFirstMock.mock.invocationCallOrder[0],
    ).toBeLessThan(getBalanceMock.mock.invocationCallOrder[0] ?? 0);
  });

  /**
   * The throttle is the row's uniqueness, so the event id is what has to be
   * stable across charges and change across fundings. It is the newest
   * bucket, and a wallet with no bucket at all still gets a stable id.
   */
  it("keys the warning on the newest bucket the wallet can spend from", async () => {
    getBalanceMock.mockResolvedValue(0n);
    prismaCreditBucketFindFirstMock.mockResolvedValue(null);

    await notifyLowBalanceAfterCharge(ORGANIZATION);

    expect(prismaCreditBucketFindFirstMock).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        // A pre-created next-period bucket is not the funding that ran low.
        OR: [{ activatesAt: null }, { activatesAt: { lte: expect.any(Date) } }],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    expect(createNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      eventId: "low-balance:none",
      messageParams: { credits: 0 },
    });
  });

  it("tells every owner and admin of an organization wallet", async () => {
    getBalanceMock.mockResolvedValue(convertCreditsToCents(5));

    await notifyLowBalanceAfterCharge(ORGANIZATION);

    expect(getBalanceMock).toHaveBeenCalledWith(
      "member-1",
      "org-1",
      expect.anything(),
    );
    expect(prismaMemberFindManyMock).toHaveBeenCalledWith({
      where: { organizationId: "org-1", role: { in: ["owner", "admin"] } },
      select: { userId: true },
    });
    expect(prismaWorkspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      select: { id: true },
    });
    expect(createNotificationMock.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({
        userId: "owner-1",
        referenceId: "org-1",
        metadata: { workspaceId: "ws-1", organizationId: "org-1" },
      }),
      expect.objectContaining({ userId: "admin-1", referenceId: "org-1" }),
    ]);
  });

  /** Best-effort: a charge that committed must not fail on its notification. */
  it("reports a failed balance read rather than throwing", async () => {
    getBalanceMock.mockRejectedValue(new Error("db down"));

    await expect(
      notifyLowBalanceAfterCharge(PERSONAL),
    ).resolves.toBeUndefined();

    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          notificationType: "billing-low-balance",
        }),
      }),
    );
  });
});

describe("notifyInvoicePaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaWorkspaceFindUniqueMock.mockResolvedValue({ id: "ws-1" });
    prismaMemberFindManyMock.mockResolvedValue([{ userId: "owner-1" }]);
    createNotificationMock.mockResolvedValue({ created: true });
    markAttentionReadMock.mockResolvedValue(1);
  });

  it("clears both warnings and writes a receipt for a top-up", async () => {
    await notifyInvoicePaid(PERSONAL, {
      invoiceId: "in_1",
      topUpCredits: 500,
      creditsGranted: true,
    });

    expect(markAttentionReadMock).toHaveBeenCalledWith(
      "user-1",
      NotificationKind.BILLING,
      "user-1",
      BILLING_ATTENTION_MESSAGE_KEYS,
      "billing-settled-read",
    );
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: "user-1",
      kind: NotificationKind.BILLING,
      referenceId: "user-1",
      eventId: "in_1",
      messageKey: BILLING_CREDITS_ADDED_MESSAGE_KEY,
      messageParams: { credits: 500 },
      metadata: { workspaceId: "ws-1", organizationId: null },
    });
  });

  /**
   * Cleared, not merely started: the receipt waits for the read to finish, so
   * a reader is never reminded of a question the receipt already answered.
   */
  it("writes the receipt only once the warnings are cleared", async () => {
    let releaseRead: () => void = () => {};
    markAttentionReadMock.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        releaseRead = () => resolve(1);
      }),
    );

    const run = notifyInvoicePaid(PERSONAL, {
      invoiceId: "in_1",
      topUpCredits: 500,
      creditsGranted: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(markAttentionReadMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).not.toHaveBeenCalled();

    releaseRead();
    await run;

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  /**
   * A renewal grants credits without the reader doing anything, so it clears
   * the warnings and says nothing. An invoice that granted nothing still
   * answers a failed payment, and only that.
   */
  it("writes no receipt for a renewal and clears only the payment warning without a grant", async () => {
    await notifyInvoicePaid(
      { userId: null, organizationId: "org-1" },
      { invoiceId: "in_2", topUpCredits: 0, creditsGranted: true },
    );
    expect(markAttentionReadMock).toHaveBeenCalledWith(
      "owner-1",
      NotificationKind.BILLING,
      "org-1",
      BILLING_ATTENTION_MESSAGE_KEYS,
      "billing-settled-read",
    );
    expect(createNotificationMock).not.toHaveBeenCalled();

    markAttentionReadMock.mockClear();
    await notifyInvoicePaid(
      { userId: null, organizationId: "org-1" },
      { invoiceId: "in_3", topUpCredits: 0, creditsGranted: false },
    );
    expect(markAttentionReadMock).toHaveBeenCalledWith(
      "owner-1",
      NotificationKind.BILLING,
      "org-1",
      [BILLING_PAYMENT_FAILED_MESSAGE_KEY],
      "billing-settled-read",
    );
  });
});

describe("notifyPaymentFailed and notifySubscriptionEnding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaWorkspaceFindUniqueMock.mockResolvedValue({ id: "ws-org" });
    prismaMemberFindManyMock.mockResolvedValue([{ userId: "owner-1" }]);
    createNotificationMock.mockResolvedValue({ created: true });
  });

  it("files a failed payment under its invoice, once however many attempts", async () => {
    await notifyPaymentFailed(
      { userId: null, organizationId: "org-1" },
      { invoiceId: "in_9" },
    );

    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: "owner-1",
      kind: NotificationKind.BILLING,
      referenceId: "org-1",
      eventId: "in_9",
      messageKey: BILLING_PAYMENT_FAILED_MESSAGE_KEY,
      messageParams: {},
      metadata: { workspaceId: "ws-org", organizationId: "org-1" },
    });
  });

  it("keys a subscription that ends on the date it ends", async () => {
    await notifySubscriptionEnding(PERSONAL, {
      stripeSubscriptionId: "sub_1",
      cancelAt: Date.parse("2027-01-15T08:00:00.000Z") / 1000,
    });
    await notifySubscriptionEnding(PERSONAL, {
      stripeSubscriptionId: "sub_1",
      cancelAt: null,
    });

    expect(createNotificationMock.mock.calls.map((call) => call[0])).toEqual([
      expect.objectContaining({
        eventId: "subscription-ending:sub_1:2027-01-15T08:00:00.000Z",
        messageKey: BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
      }),
      expect.objectContaining({
        eventId: "subscription-ending:sub_1:period-end",
      }),
    ]);
  });

  it("reports a write that failed rather than throwing", async () => {
    createNotificationMock.mockRejectedValue(new Error("unique index gone"));

    await expect(
      notifyPaymentFailed(PERSONAL, { invoiceId: "in_1" }),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          notificationType: "billing-payment-failed",
        }),
      }),
    );
  });
});

describe("resolveBillingWalletByStripeCustomerId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the user before the organization, and nobody for a stranger", async () => {
    getUserByStripeCustomerIdMock.mockResolvedValue({ id: "user-7" });
    await expect(
      resolveBillingWalletByStripeCustomerId("cus_user"),
    ).resolves.toEqual({ userId: "user-7", organizationId: null });

    getUserByStripeCustomerIdMock.mockResolvedValue(null);
    getOrganizationByStripeCustomerIdMock.mockResolvedValue({ id: "org-7" });
    await expect(
      resolveBillingWalletByStripeCustomerId("cus_org"),
    ).resolves.toEqual({ userId: null, organizationId: "org-7" });

    getOrganizationByStripeCustomerIdMock.mockResolvedValue(null);
    await expect(
      resolveBillingWalletByStripeCustomerId("cus_nobody"),
    ).resolves.toBeNull();
  });
});
