import * as Sentry from "@sentry/node";
import { MemberRole, NotificationKind } from "@sokosumi/database";
import { creditBucketActivatesAtOrBefore } from "@sokosumi/database/helpers";
import {
  creditBucketRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import {
  BILLING_CREDITS_ADDED_MESSAGE_KEY,
  BILLING_LOW_BALANCE_MESSAGE_KEY,
  BILLING_PAYMENT_FAILED_MESSAGE_KEY,
  BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
  convertCentsToCredits,
  convertCreditsToCents,
} from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import { sendBillingNotificationEmail } from "@/helpers/billing-notification-email";
import { BILLING_ATTENTION_MESSAGE_KEYS } from "@/helpers/notification-delivery";
import { markAttentionRead } from "@/helpers/notification-read";
import { createNotification } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

/**
 * The wallet a billing notification is about (SOK-932).
 *
 * An organization's credits are one wallet its owners and admins answer for,
 * and a user's personal credits are another. The organization wins when both
 * are set, because that is the wallet the charge came out of: a member
 * spending inside an organization spends the organization's credits.
 *
 * `userId` is null when Stripe named an organization customer, where no one
 * member is the subject. It is required for a low-balance check, because the
 * balance an organization member can spend depends on their seat.
 */
export interface BillingWallet {
  userId: string | null;
  organizationId: string | null;
}

/** The wallet a member charged, with the member named. */
export interface ChargedBillingWallet extends BillingWallet {
  userId: string;
}

/**
 * The row every billing notification is filed under.
 *
 * The wallet rather than the invoice or the charge, so a notification about
 * the same wallet a day later lands beside it, and so the settled read that
 * clears a warning can find the rows it is clearing without knowing which
 * charge wrote them.
 */
function walletReferenceId(wallet: BillingWallet): string {
  const referenceId = wallet.organizationId ?? wallet.userId;

  if (!referenceId) {
    throw new Error("A billing wallet names a user or an organization");
  }

  return referenceId;
}

/**
 * Who is told about a wallet.
 *
 * An organization's owners and admins, because they are the members who can
 * do something about it: `authorizeReference` in `lib/auth.ts` lets nobody
 * else open the billing portal or change the subscription. A personal wallet
 * has exactly one reader.
 */
async function billingRecipients(wallet: BillingWallet): Promise<string[]> {
  if (wallet.organizationId) {
    const members = await prisma.member.findMany({
      where: {
        organizationId: wallet.organizationId,
        role: { in: [MemberRole.OWNER, MemberRole.ADMIN] },
      },
      select: { userId: true },
    });

    return members.map((member) => member.userId);
  }

  return wallet.userId ? [wallet.userId] : [];
}

/**
 * The workspace a click switches to before it opens the billing page.
 *
 * Web reads `metadata.workspaceId` and nothing else for that switch
 * (`notification-navigation.ts`). A wallet belongs to one workspace: the
 * organization's, or the user's personal one.
 */
async function billingWorkspaceId(
  wallet: BillingWallet,
): Promise<string | null> {
  const workspace = wallet.organizationId
    ? await prisma.workspace.findUnique({
        where: { organizationId: wallet.organizationId },
        select: { id: true },
      })
    : wallet.userId
      ? await prisma.workspace.findUnique({
          where: { userId: wallet.userId },
          select: { id: true },
        })
      : null;

  return workspace?.id ?? null;
}

async function writeBillingNotification(
  wallet: BillingWallet,
  input: {
    eventId: string;
    messageKey: string;
    messageParams: Record<string, unknown>;
  },
): Promise<void> {
  const referenceId = walletReferenceId(wallet);
  const [recipients, workspaceId] = await Promise.all([
    billingRecipients(wallet),
    billingWorkspaceId(wallet),
  ]);

  for (const userId of recipients) {
    try {
      const { created } = await createNotification({
        userId,
        kind: NotificationKind.BILLING,
        referenceId,
        eventId: input.eventId,
        messageKey: input.messageKey,
        messageParams: input.messageParams,
        metadata: { workspaceId, organizationId: wallet.organizationId },
      });

      // A duplicate row is the throttle: mailing it again would be a second
      // warning for the same funding. Stripe already mails the other three
      // billing keys, so only a newly written low-balance row reaches inbox.
      if (created) {
        await sendBillingNotificationEmail({
          userId,
          messageKey: input.messageKey,
          messageParams: input.messageParams,
        });
      }
    } catch (error) {
      reportBillingNotificationFailure(error, wallet, "billing-recipient");
    }
  }
}

function reportBillingNotificationFailure(
  error: unknown,
  wallet: BillingWallet,
  notificationType: string,
): void {
  Sentry.captureException(error, {
    extra: {
      userId: wallet.userId,
      organizationId: wallet.organizationId,
      notificationType,
    },
  });
}

/**
 * Tell the wallet's readers it is running low, once per funding.
 *
 * Called after a charge commits, never inside its transaction: the write
 * publishes over realtime, and a notification about a charge that then rolls
 * back would be a lie. Best-effort by design, because a notification failure
 * must never fail the request that committed the charge.
 *
 * The throttle is the notification table's own uniqueness. The event id is
 * the newest bucket the wallet can spend from, so the first charge that finds
 * the balance under the threshold writes the row and every later one is
 * refused as a duplicate. A top-up or a new subscription period adds a
 * bucket, and the next crossing is a new event. A balance that only sinks
 * further never says so twice, and one that bounces around the threshold,
 * say through a refund, does not either. Only spendable buckets count: the
 * free plan pre-creates the next period's bucket minutes early, and a warning
 * keyed on it would be spent before that period began and never fire again
 * inside it.
 *
 * The bucket is read before the balance. The two reads are not one snapshot,
 * and a top-up that commits between them must not be the funding this
 * warning is keyed on: read the other way round, the row would say the old
 * balance, sit unread on a full wallet, and spend the new funding's one
 * warning before it was needed.
 *
 * Read from the member's own view of the balance (`getBalance` scopes an
 * organization wallet by the member's seat), because that is the balance
 * whose exhaustion stops their work. A threshold of zero is the off switch:
 * no balance is below it.
 */
export async function notifyLowBalanceAfterCharge(
  wallet: ChargedBillingWallet,
): Promise<void> {
  try {
    const threshold = convertCreditsToCents(getEnv().LOW_CREDITS_THRESHOLD);
    const newestBucket = await prisma.creditBucket.findFirst({
      where: {
        ...(wallet.organizationId
          ? { organizationId: wallet.organizationId }
          : { userId: wallet.userId, organizationId: null }),
        ...creditBucketActivatesAtOrBefore(new Date()),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const balance = await creditBucketRepository.getBalance(
      wallet.userId,
      wallet.organizationId,
      prisma,
    );

    if (balance >= threshold) {
      return;
    }

    await writeBillingNotification(wallet, {
      eventId: `low-balance:${newestBucket?.id ?? "none"}`,
      messageKey: BILLING_LOW_BALANCE_MESSAGE_KEY,
      messageParams: {
        credits: Math.max(0, Math.floor(convertCentsToCredits(balance))),
      },
    });
  } catch (error) {
    reportBillingNotificationFailure(error, wallet, "billing-low-balance");
  }
}

/**
 * An invoice was paid: settle what it settles, then say what it added.
 *
 * A paid invoice answers a failed payment whatever it was for, so that
 * warning is cleared first. Credits that landed answer the low-balance
 * warning too. Cleared before the receipt is written, for the reason the
 * task path gives: a reader who tops up has done the thing the warning
 * asked, and a reminder about it a day later would be about a question
 * nobody is asking (SOK-916).
 *
 * The receipt is written only for a top-up. A subscription renewal grants
 * credits as well, but the reader did not act to get them and would be told
 * so every month.
 */
export async function notifyInvoicePaid(
  wallet: BillingWallet,
  input: { invoiceId: string; topUpCredits: number; creditsGranted: boolean },
): Promise<void> {
  try {
    const referenceId = walletReferenceId(wallet);
    const clearedKeys = input.creditsGranted
      ? BILLING_ATTENTION_MESSAGE_KEYS
      : [BILLING_PAYMENT_FAILED_MESSAGE_KEY];

    for (const userId of await billingRecipients(wallet)) {
      await markAttentionRead(
        userId,
        NotificationKind.BILLING,
        referenceId,
        clearedKeys,
        "billing-settled-read",
      );
    }

    if (input.topUpCredits > 0) {
      await writeBillingNotification(wallet, {
        eventId: input.invoiceId,
        messageKey: BILLING_CREDITS_ADDED_MESSAGE_KEY,
        messageParams: { credits: input.topUpCredits },
      });
    }
  } catch (error) {
    reportBillingNotificationFailure(error, wallet, "billing-invoice-paid");
  }
}

/**
 * A subscription payment did not go through.
 *
 * Stripe retries a failed invoice on its own schedule and reports each
 * attempt, so the invoice id is the event: one row per invoice, however
 * many attempts it takes.
 */
export async function notifyPaymentFailed(
  wallet: BillingWallet,
  input: { invoiceId: string },
): Promise<void> {
  try {
    await writeBillingNotification(wallet, {
      eventId: input.invoiceId,
      messageKey: BILLING_PAYMENT_FAILED_MESSAGE_KEY,
      messageParams: {},
    });
  } catch (error) {
    reportBillingNotificationFailure(error, wallet, "billing-payment-failed");
  }
}

/**
 * The subscription was set to end when the current period does.
 *
 * Keyed on the subscription and the date it ends, so a reader who cancels,
 * resumes and cancels again inside one period is told once, and one who
 * cancels in a later period is told again.
 */
export async function notifySubscriptionEnding(
  wallet: BillingWallet,
  input: { stripeSubscriptionId: string; cancelAt: number | null },
): Promise<void> {
  try {
    const endsAt = input.cancelAt
      ? new Date(input.cancelAt * 1000).toISOString()
      : "period-end";

    await writeBillingNotification(wallet, {
      eventId: `subscription-ending:${input.stripeSubscriptionId}:${endsAt}`,
      messageKey: BILLING_SUBSCRIPTION_ENDING_MESSAGE_KEY,
      messageParams: {},
    });
  } catch (error) {
    reportBillingNotificationFailure(
      error,
      wallet,
      "billing-subscription-ending",
    );
  }
}

/**
 * The wallet behind a Stripe customer, or null when Sokosumi holds none.
 *
 * A user and an organization each carry their own Stripe customer id, and an
 * event names one customer. Null rather than a throw for an unknown customer:
 * invoice.paid looks the customer up on Stripe and acks a permanent miss,
 * but a notification is not worth that extra round trip.
 */
export async function resolveBillingWalletByStripeCustomerId(
  stripeCustomerId: string,
): Promise<BillingWallet | null> {
  const user = await userRepository.getUserByStripeCustomerId(
    stripeCustomerId,
    prisma,
  );

  if (user) {
    return { userId: user.id, organizationId: null };
  }

  const organization =
    await organizationRepository.getOrganizationByStripeCustomerId(
      stripeCustomerId,
      prisma,
    );

  return organization
    ? { userId: null, organizationId: organization.id }
    : null;
}
