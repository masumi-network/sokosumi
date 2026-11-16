import {
  BILLING_CREDITS_ADDED_MESSAGE_KEY,
  BILLING_CUSO_LOW_CREDITS_MESSAGE_KEY,
  BILLING_LOW_BALANCE_MESSAGE_KEY,
  BILLING_PAYMENT_FAILED_MESSAGE_KEY,
  BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
} from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaUserFindUniqueMock, resolveDeliveryMock, sendEmailMock } =
  vi.hoisted(() => ({
    prismaUserFindUniqueMock: vi.fn(),
    resolveDeliveryMock: vi.fn(),
    sendEmailMock: vi.fn(),
  }));

vi.mock("@/clients/email.client", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock("@/helpers/notifications", () => ({
  resolveDelivery: (...args: unknown[]) => resolveDeliveryMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => prismaUserFindUniqueMock(...args),
    },
  },
}));

import {
  sendBillingNotificationEmail,
  sendCusoLowCreditsEmail,
} from "./billing-notification-email";

describe("sendBillingNotificationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveDeliveryMock.mockResolvedValue({
      inApp: true,
      osBanner: false,
      email: true,
    });
    prismaUserFindUniqueMock.mockResolvedValue({
      email: "reader@example.com",
      name: "Ada",
    });
    sendEmailMock.mockResolvedValue({ id: "email_1" });
  });

  it("mails a low balance to the credits tab", async () => {
    await sendBillingNotificationEmail({
      userId: "user-1",
      messageKey: BILLING_LOW_BALANCE_MESSAGE_KEY,
      messageParams: { credits: 12 },
    });

    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "reader@example.com",
        tag: "billing-low-balance",
        subject: "Sokosumi - Your credits are running low",
      }),
    );
    expect(sendEmailMock.mock.calls[0]?.[0].html).toContain(
      "https://example.com/billing?tab=credits",
    );
    expect(sendEmailMock.mock.calls[0]?.[0].html).toContain("12");
  });

  it("skips the inbox when the reader turned that cell off", async () => {
    resolveDeliveryMock.mockResolvedValue({
      inApp: true,
      osBanner: false,
      email: false,
    });

    await sendBillingNotificationEmail({
      userId: "user-1",
      messageKey: BILLING_LOW_BALANCE_MESSAGE_KEY,
      messageParams: { credits: 12 },
    });

    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  /**
   * Stripe already writes these. A Sokosumi row in the Notification Center is
   * still useful; a second email is not.
   */
  it.each([
    BILLING_PAYMENT_FAILED_MESSAGE_KEY,
    BILLING_CREDITS_ADDED_MESSAGE_KEY,
    BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
  ])("does not mail %s, which Stripe already mails", async (messageKey) => {
    await sendBillingNotificationEmail({
      userId: "user-1",
      messageKey,
      messageParams: { credits: 12 },
    });

    expect(resolveDeliveryMock).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("sendCusoLowCreditsEmail", () => {
  const CUSO_EMAIL = {
    userId: "hirer-1",
    cusoName: "Cuso",
    businessName: "acme.com",
    credits: 900,
    nextGrantAt: new Date("2026-12-01T00:00:00.000Z"),
    actionUrl: "https://app.cmo.xyz/settings?project=p-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolveDeliveryMock.mockResolvedValue({
      inApp: true,
      osBanner: false,
      email: true,
    });
    prismaUserFindUniqueMock.mockResolvedValue({
      email: "hirer@example.com",
      name: "Ada",
    });
  });

  it("mails the hirer a link to CMO's top-up and plan screen", async () => {
    await sendCusoLowCreditsEmail(CUSO_EMAIL);

    expect(resolveDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "hirer-1",
        messageKey: BILLING_CUSO_LOW_CREDITS_MESSAGE_KEY,
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "hirer@example.com",
        tag: "cuso-low-credits",
        subject: "CMO - Cuso for acme.com is running low on credits",
      }),
    );
    const html: string = sendEmailMock.mock.calls[0]?.[0].html;
    expect(html).toContain("https://app.cmo.xyz/settings?project=p-1");
    expect(html).not.toContain("/billing");
  });

  it("skips the inbox when the reader turned billing alerts off", async () => {
    resolveDeliveryMock.mockResolvedValue({
      inApp: true,
      osBanner: false,
      email: false,
    });

    await sendCusoLowCreditsEmail(CUSO_EMAIL);

    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
