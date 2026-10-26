import { getEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { verifyNewsletterUnsubscribeToken } from "@/lib/newsletter/unsubscribe-token";

export async function getNewsletterUnsubscribeSubscriber(token: string) {
  const { subscriberId, newsletterId } = verifyNewsletterUnsubscribeToken(
    token,
    getEnv().BETTER_AUTH_SECRET,
  );
  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: { id: subscriberId, newsletterId },
    include: { newsletter: { select: { name: true } } },
  });
  if (!subscriber) throw notFound("Subscriber not found");
  return subscriber;
}

export async function unsubscribeNewsletterSubscriber(token: string) {
  const subscriber = await getNewsletterUnsubscribeSubscriber(token);
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const { count } = await tx.newsletterSubscriber.updateMany({
      where: {
        id: subscriber.id,
        newsletterId: subscriber.newsletterId,
        status: { not: "UNSUBSCRIBED" },
      },
      data: { status: "UNSUBSCRIBED", unsubscribedAt: now },
    });
    if (count) {
      await tx.newsletterEvent.create({
        data: {
          newsletterId: subscriber.newsletterId,
          subscriberId: subscriber.id,
          type: "UNSUBSCRIBED",
          occurredAt: now,
        },
      });
    }
  });
  return subscriber;
}
