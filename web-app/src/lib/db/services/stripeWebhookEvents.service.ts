import prisma from "@/lib/db/prisma";
import { Prisma, StripeWebhookEvent } from "@/prisma/generated/client";
import { StripeWebhookEventStatus } from "@/prisma/generated/client/client";

export const setStripeWebhookEventStatusToCompleted = async (
  eventId: string,
  tx: Prisma.TransactionClient = prisma,
) => {
  return await tx.stripeWebhookEvent.update({
    where: { eventId },
    data: { status: StripeWebhookEventStatus.COMPLETED },
  });
};

export const getOrCreateStripeWebhookEvent = async (
  eventId: string,
  checkoutSessionId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<StripeWebhookEvent> => {
  let event = await tx.stripeWebhookEvent.findUnique({ where: { eventId } });
  event ??= await tx.stripeWebhookEvent.create({
    data: {
      eventId,
      checkoutSessionId,
    },
  });
  return event;
};
