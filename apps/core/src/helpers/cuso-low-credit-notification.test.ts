import { NotificationKind } from "@sokosumi/database";
import {
  BILLING_CUSO_LOW_CREDITS_MESSAGE_KEY,
  convertCreditsToCents,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkScope } from "@/lib/db/network-scope";

const {
  captureExceptionMock,
  createNotificationMock,
  creditBucketFindManyMock,
  cmoRunnerUserIdMock,
  getCmoCatalogMock,
  polarSubscriptionFindFirstMock,
  sendCusoLowCreditsEmailMock,
  sokoBotFindFirstMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  createNotificationMock: vi.fn(),
  creditBucketFindManyMock: vi.fn(),
  cmoRunnerUserIdMock: vi.fn(),
  getCmoCatalogMock: vi.fn(),
  polarSubscriptionFindFirstMock: vi.fn(),
  sendCusoLowCreditsEmailMock: vi.fn(),
  sokoBotFindFirstMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ CMO_APP_BASE_URL: "https://app.cmo.xyz" }),
}));

vi.mock("@/helpers/billing-notification-email", () => ({
  sendCusoLowCreditsEmail: (...args: unknown[]) =>
    sendCusoLowCreditsEmailMock(...args),
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}));

vi.mock("@/services/cmo-cuso.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/cmo-cuso.service")>()),
  cmoRunnerUserId: (...args: unknown[]) => cmoRunnerUserIdMock(...args),
}));

vi.mock("@/services/cmo-catalog.service", () => ({
  getCmoCatalog: (...args: unknown[]) => getCmoCatalogMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  networkPrisma: () => ({
    creditBucket: { findMany: creditBucketFindManyMock },
  }),
  default: {
    creditBucket: {
      findMany: (...args: unknown[]) => creditBucketFindManyMock(...args),
    },
    polarSubscription: {
      findFirst: (...args: unknown[]) =>
        polarSubscriptionFindFirstMock(...args),
    },
    sokoBot: {
      findFirst: (...args: unknown[]) => sokoBotFindFirstMock(...args),
    },
  },
}));

import { notifyCusoLowCreditsAfterCharge } from "./cuso-low-credit-notification";

const PROJECT_ID = "01960001-0001-7001-8001-0000000000aa";
const NOW = new Date("2026-11-16T12:00:00.000Z");

/** A Project bucket holding `left` credits, created at `createdAt`. */
function bucket(
  id: string,
  left: number,
  createdAt: string,
  expiresAt: string | null = null,
) {
  return {
    id,
    createdAt: new Date(createdAt),
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    amount: convertCreditsToCents(left + 100),
    consumptions: [{ amount: convertCreditsToCents(100) }],
  };
}

const MONTHLY_PLAN = {
  polarProductId: "prod_starter_month",
  interval: "month",
  status: "active",
  currentPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
  cancelAtPeriodEnd: false,
  lastPaidOrderRefundedAt: null,
};

describe("notifyCusoLowCreditsAfterCharge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sokoBotFindFirstMock.mockResolvedValue({
      id: "bot-1",
      workspaceId: "ws-1",
      name: "Cuso",
      workspace: { organizationId: "org-1" },
      project: { websiteUrl: "https://www.acme.com" },
    });
    cmoRunnerUserIdMock.mockResolvedValue("hirer-1");
    polarSubscriptionFindFirstMock.mockResolvedValue(MONTHLY_PLAN);
    getCmoCatalogMock.mockResolvedValue({
      plans: [{ productId: "prod_starter_month", credits: 10_000 }],
      topUps: [],
    });
    createNotificationMock.mockResolvedValue({ created: true });
  });

  it("tells the person who hired a subscribed Cuso once he is under a tenth of his plan's month", async () => {
    creditBucketFindManyMock.mockResolvedValue([
      bucket("month-1", 600, "2026-11-01T00:00:00.000Z"),
      bucket("top-up-1", 300, "2026-11-10T00:00:00.000Z"),
    ]);

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: "hirer-1",
      kind: NotificationKind.BILLING,
      referenceId: PROJECT_ID,
      // The newest bucket: a grant or top-up is a new crossing.
      eventId: "cuso-low-credits:top-up-1",
      messageKey: BILLING_CUSO_LOW_CREDITS_MESSAGE_KEY,
      messageParams: {
        cusoName: "Cuso",
        businessName: "acme.com",
        credits: 900,
        nextGrantAt: "2026-12-01T00:00:00.000Z",
      },
      metadata: {
        organizationId: "org-1",
        projectId: PROJECT_ID,
        url: `https://app.cmo.xyz/settings?project=${PROJECT_ID}`,
      },
    });
    expect(sendCusoLowCreditsEmailMock).toHaveBeenCalledWith({
      userId: "hirer-1",
      cusoName: "Cuso",
      businessName: "acme.com",
      credits: 900,
      nextGrantAt: new Date("2026-12-01T00:00:00.000Z"),
      actionUrl: `https://app.cmo.xyz/settings?project=${PROJECT_ID}`,
    });
    // Only his own Project's credits count, never the Organization pool.
    expect(creditBucketFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ projectId: PROJECT_ID }]),
        }),
      }),
    );
  });

  it("stays quiet while his Project credits are at or above the threshold", async () => {
    creditBucketFindManyMock.mockResolvedValue([
      bucket("month-1", 1_000, "2026-11-01T00:00:00.000Z"),
    ]);

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("mails nothing for a charge after the crossing, which the notification table refuses as a duplicate", async () => {
    creditBucketFindManyMock.mockResolvedValue([
      bucket("month-1", 200, "2026-11-01T00:00:00.000Z"),
    ]);
    createNotificationMock.mockResolvedValue({ created: false });

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "cuso-low-credits:month-1" }),
    );
    expect(sendCusoLowCreditsEmailMock).not.toHaveBeenCalled();
  });

  it("uses 1,000 credits and names no next grant for a Cuso on Tester credits", async () => {
    polarSubscriptionFindFirstMock.mockResolvedValue(null);
    creditBucketFindManyMock.mockResolvedValue([
      bucket("tester-1", 999, "2026-10-01T00:00:00.000Z"),
    ]);

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(getCmoCatalogMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: expect.objectContaining({
          credits: 999,
          nextGrantAt: null,
        }),
      }),
    );
  });

  it("names the next month of a yearly plan as its next grant", async () => {
    polarSubscriptionFindFirstMock.mockResolvedValue({
      ...MONTHLY_PLAN,
      interval: "year",
      currentPeriodStart: new Date("2026-03-05T00:00:00.000Z"),
      currentPeriodEnd: new Date("2027-03-05T00:00:00.000Z"),
    });
    creditBucketFindManyMock.mockResolvedValue([
      bucket("month-8", 10, "2026-11-05T00:00:00.000Z"),
    ]);

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: expect.objectContaining({
          nextGrantAt: "2026-12-05T00:00:00.000Z",
        }),
      }),
    );
  });

  it("names no next grant for a plan that is cancelled at the period end", async () => {
    polarSubscriptionFindFirstMock.mockResolvedValue({
      ...MONTHLY_PLAN,
      cancelAtPeriodEnd: true,
    });
    creditBucketFindManyMock.mockResolvedValue([
      bucket("month-1", 10, "2026-11-01T00:00:00.000Z"),
    ]);

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: expect.objectContaining({ nextGrantAt: null }),
      }),
    );
  });

  it("does nothing for a Project without a live Cuso or without anyone to tell", async () => {
    sokoBotFindFirstMock.mockResolvedValue(null);
    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    sokoBotFindFirstMock.mockResolvedValue({
      id: "bot-1",
      workspaceId: "ws-1",
      name: "Cuso",
      workspace: { organizationId: "org-1" },
      project: { websiteUrl: "https://acme.com" },
    });
    cmoRunnerUserIdMock.mockResolvedValue(null);
    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(creditBucketFindManyMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("tells the current member who answers for Cuso when his hirer left the organization", async () => {
    cmoRunnerUserIdMock.mockResolvedValue("owner-2");
    creditBucketFindManyMock.mockResolvedValue([
      bucket("month-1", 200, "2026-11-01T00:00:00.000Z"),
    ]);

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(cmoRunnerUserIdMock).toHaveBeenCalledWith({
      sokoBotId: "bot-1",
      workspaceId: "ws-1",
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-2" }),
    );
    expect(sendCusoLowCreditsEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "owner-2" }),
    );
  });

  it("keeps the crossing's key when the newest bucket expires without new funding", async () => {
    creditBucketFindManyMock.mockResolvedValue([
      bucket(
        "top-up-1",
        200,
        "2026-10-01T00:00:00.000Z",
        "2027-10-01T00:00:00.000Z",
      ),
      // Last month's grant: expired, so it holds nothing spendable.
      bucket(
        "month-1",
        5_000,
        "2026-10-20T00:00:00.000Z",
        "2026-11-01T00:00:00.000Z",
      ),
    ]);

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "cuso-low-credits:month-1",
        messageParams: expect.objectContaining({ credits: 200 }),
      }),
    );
  });

  it("names the renewal, not next month, for a yearly plan whose paid order was refunded", async () => {
    polarSubscriptionFindFirstMock.mockResolvedValue({
      ...MONTHLY_PLAN,
      interval: "year",
      currentPeriodStart: new Date("2026-03-05T00:00:00.000Z"),
      currentPeriodEnd: new Date("2027-03-05T00:00:00.000Z"),
      lastPaidOrderRefundedAt: new Date("2026-10-01T00:00:00.000Z"),
    });
    creditBucketFindManyMock.mockResolvedValue([
      bucket("top-up-1", 10, "2026-11-05T00:00:00.000Z"),
    ]);

    await notifyCusoLowCreditsAfterCharge(
      PROJECT_ID,
      createNetworkScope("mainnet"),
      NOW,
    );

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: expect.objectContaining({
          nextGrantAt: "2027-03-05T00:00:00.000Z",
        }),
      }),
    );
  });

  it("reports a failure instead of failing the charge that committed", async () => {
    creditBucketFindManyMock.mockRejectedValue(new Error("db down"));

    await expect(
      notifyCusoLowCreditsAfterCharge(
        PROJECT_ID,
        createNetworkScope("mainnet"),
        NOW,
      ),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      extra: { projectId: PROJECT_ID, notificationType: "cuso-low-credits" },
    });
  });
});
