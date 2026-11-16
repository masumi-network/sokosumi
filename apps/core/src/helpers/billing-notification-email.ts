import { NotificationKind } from "@sokosumi/database";
import {
  BILLING_CUSO_LOW_CREDITS_MESSAGE_KEY,
  BILLING_LOW_BALANCE_MESSAGE_KEY,
} from "@sokosumi/utils";

import type { SendEmailInput } from "@/clients/email.client";
import { sendEmail } from "@/clients/email.client";
import { getWebAppBaseUrl } from "@/config/env";
import { notificationSettingsLink } from "@/helpers/notification-email-link";
import { resolveDelivery } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

interface BillingNotificationEmailInput {
  userId: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
}

/**
 * The inbox copy for a billing row that just landed, or nothing.
 *
 * Only a low balance mails. Stripe already writes when a payment fails, when
 * a top-up receipt lands, and when a subscription is set to end, so those
 * rows stay in Sokosumi and off the inbox (SOK-932).
 *
 * The reader's BILLING_ATTENTION email cell still gates this. A category
 * that mails defaults on; a reader who switched that cell off is skipped.
 */
export async function sendBillingNotificationEmail(
  input: BillingNotificationEmailInput,
): Promise<void> {
  if (input.messageKey !== BILLING_LOW_BALANCE_MESSAGE_KEY) {
    return;
  }

  const credits = input.messageParams.credits;

  if (typeof credits !== "number") {
    return;
  }

  const reader = await billingEmailReader(input);

  if (!reader) {
    return;
  }

  const { renderLowBalanceEmail } = await import("@sokosumi/email");
  const rendered = await renderLowBalanceEmail({
    actionUrl: `${getWebAppBaseUrl()}/billing?tab=credits`,
    credits,
    locale: "en",
    recipientName: reader.name,
    settingsUrl: notificationSettingsLink(),
  });

  const email: SendEmailInput = {
    to: reader.email,
    tag: "billing-low-balance",
    subject: rendered.subject,
    html: rendered.html,
  };

  await sendEmail(email);
}

/**
 * A Cuso's low-credit notice (SOKD-246), mailed to the person who hired him.
 * The same BILLING_ATTENTION email cell gates it; the action opens CMO's
 * top-up and plan screen, never Sokosumi's billing page.
 */
export async function sendCusoLowCreditsEmail(input: {
  userId: string;
  cusoName: string;
  businessName: string;
  credits: number;
  nextGrantAt: Date | null;
  actionUrl: string;
}): Promise<void> {
  const reader = await billingEmailReader({
    userId: input.userId,
    messageKey: BILLING_CUSO_LOW_CREDITS_MESSAGE_KEY,
    messageParams: { credits: input.credits },
  });

  if (!reader) {
    return;
  }

  const { renderCusoLowCreditsEmail } = await import("@sokosumi/email");
  const rendered = await renderCusoLowCreditsEmail({
    actionUrl: input.actionUrl,
    businessName: input.businessName,
    credits: input.credits,
    cusoName: input.cusoName,
    locale: "en",
    nextGrantAt: input.nextGrantAt,
    recipientName: reader.name,
    settingsUrl: notificationSettingsLink(),
  });

  await sendEmail({
    to: reader.email,
    tag: "cuso-low-credits",
    subject: rendered.subject,
    html: rendered.html,
  });
}

/** The reader to mail, or null when their email cell is off or they have no address. */
async function billingEmailReader(
  input: BillingNotificationEmailInput,
): Promise<{ email: string; name: string } | null> {
  const delivery = await resolveDelivery({
    userId: input.userId,
    kind: NotificationKind.BILLING,
    referenceId: input.userId,
    eventId: "billing-email",
    messageKey: input.messageKey,
    messageParams: input.messageParams,
  });

  if (!delivery.email) {
    return null;
  }

  const reader = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, name: true },
  });

  return reader?.email ? { email: reader.email, name: reader.name } : null;
}
