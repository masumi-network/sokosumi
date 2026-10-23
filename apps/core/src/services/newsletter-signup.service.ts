import { captureException } from "@sentry/node";
import {
  renderNewsletterConfirmationEmail,
  renderNewsletterEmail,
} from "@sokosumi/email";

import { sendEmail } from "@/clients/email.client";
import { getEnv } from "@/config/env";
import { badRequest, notFound } from "@/helpers/error";
import { NEWSLETTER_BETA_PROJECT_WHERE } from "@/helpers/newsletter-beta-access";
import prisma from "@/lib/db/prisma";
import {
  signNewsletterConfirmToken,
  verifyNewsletterConfirmToken,
} from "@/lib/newsletter/confirm-token";
import {
  newsletterPublicUrl,
  newsletterSenderOptions,
  newsletterUnsubscribeOptions,
} from "@/lib/newsletter/email";
import { assertNewsletterEnabled } from "@/lib/newsletter/feature";
import { allowNewsletterSignup } from "@/lib/newsletter/signup-limit";
import {
  newsletterBrandSchema,
  type SubscribeNewsletterRequest,
} from "@/schemas/newsletter.schema";

const CONFIRMATION_RESEND_MS = 10 * 60_000;

export async function getPublicNewsletter(publicSlug: string) {
  assertNewsletterEnabled();
  const newsletter = await prisma.newsletter.findUnique({
    where: { publicSlug, project: NEWSLETTER_BETA_PROJECT_WHERE },
    select: { name: true, senderName: true, brand: true },
  });
  if (!newsletter) throw notFound("Newsletter not found");
  return newsletter;
}

export async function subscribeToNewsletter(
  publicSlug: string,
  input: SubscribeNewsletterRequest,
  request: Request,
): Promise<void> {
  assertNewsletterEnabled();
  if (input.website) return;
  const newsletter = await prisma.newsletter.findUnique({
    where: { publicSlug, project: NEWSLETTER_BETA_PROJECT_WHERE },
  });
  if (!newsletter) throw notFound("Newsletter not found");
  if (!(await allowNewsletterSignup(newsletter.id, request))) return;

  const now = new Date();
  const subscriber = await prisma.$transaction(async (tx) => {
    const { count: created } = await tx.newsletterSubscriber.createMany({
      data: {
        newsletterId: newsletter.id,
        email: input.email,
        name: input.name,
        status: "PENDING",
        source: "SIGNUP_FORM",
        consentAt: now,
      },
      skipDuplicates: true,
    });
    const subscriber = await tx.newsletterSubscriber.findUnique({
      where: {
        newsletterId_email: { newsletterId: newsletter.id, email: input.email },
      },
    });
    if (!subscriber) return null;
    if (!created) {
      if (subscriber.status === "ACTIVE" || subscriber.status === "BOUNCED")
        return null;
      if (
        subscriber.status === "PENDING" &&
        subscriber.consentAt &&
        subscriber.consentAt.getTime() > now.getTime() - CONFIRMATION_RESEND_MS
      )
        return null;
      // Reserve dispatch atomically; consentAt also invalidates older opt-in links.
      const { count } = await tx.newsletterSubscriber.updateMany({
        where: {
          id: subscriber.id,
          status: subscriber.status,
          consentAt: subscriber.consentAt,
        },
        data: {
          status: "PENDING",
          consentAt: now,
          source: "SIGNUP_FORM",
          name: input.name,
          unsubscribedAt: null,
        },
      });
      if (!count) return null;
    }
    await tx.newsletterEvent.create({
      data: {
        newsletterId: newsletter.id,
        subscriberId: subscriber.id,
        type: "SUBSCRIBED",
        occurredAt: now,
      },
    });
    return subscriber;
  });
  if (!subscriber) return;

  try {
    const confirmUrl = newsletterPublicUrl("confirm");
    confirmUrl.searchParams.set(
      "token",
      signNewsletterConfirmToken(
        {
          newsletterId: newsletter.id,
          subscriberId: subscriber.id,
          consentAt: now.getTime(),
        },
        getEnv().BETTER_AUTH_SECRET,
      ),
    );
    const { unsubscribeUrl, headers } = newsletterUnsubscribeOptions({
      newsletterId: newsletter.id,
      subscriberId: subscriber.id,
    });
    const rendered = await renderNewsletterConfirmationEmail({
      newsletter: {
        ...newsletter,
        brand: newsletterBrandSchema.parse(newsletter.brand),
      },
      confirmUrl: confirmUrl.href,
      unsubscribeUrl,
      locale: input.locale,
    });
    await sendEmail({
      to: subscriber.email,
      ...rendered,
      ...newsletterSenderOptions(newsletter),
      headers,
      tag: "newsletter-confirmation",
    });
  } catch (error) {
    // Provider failures must not expose whether the address needed confirmation.
    captureException(error, { tags: { context: "newsletter_confirmation" } });
  }
}

export async function getNewsletterConfirmSubscriber(token: string) {
  assertNewsletterEnabled();
  const { newsletterId, subscriberId, consentAt } =
    verifyNewsletterConfirmToken(token, getEnv().BETTER_AUTH_SECRET);
  const subscriber = await prisma.newsletterSubscriber.findUnique({
    where: {
      id: subscriberId,
      newsletterId,
      newsletter: { project: NEWSLETTER_BETA_PROJECT_WHERE },
    },
    include: { newsletter: true },
  });
  if (!subscriber) throw notFound("Subscriber not found");
  if (subscriber.consentAt?.getTime() !== consentAt) {
    throw badRequest("Invalid or expired confirmation token");
  }
  if (subscriber.status !== "PENDING" && subscriber.status !== "ACTIVE") {
    throw badRequest("This subscription cannot be confirmed");
  }
  return subscriber;
}

export async function confirmNewsletterSubscriber(
  token: string,
  locale: string,
) {
  const subscriber = await getNewsletterConfirmSubscriber(token);
  const activated = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const { count } = await tx.newsletterSubscriber.updateMany({
      where: {
        id: subscriber.id,
        newsletterId: subscriber.newsletterId,
        status: "PENDING",
        consentAt: subscriber.consentAt,
      },
      data: { status: "ACTIVE", confirmedAt: now },
    });
    if (count)
      await tx.newsletterEvent.create({
        data: {
          newsletterId: subscriber.newsletterId,
          subscriberId: subscriber.id,
          type: "CONFIRMED",
          occurredAt: now,
        },
      });
    return count > 0;
  });
  const newsletter = subscriber.newsletter;
  // Keep confirmedAt across fresh opt-ins so a subscriber never gets two welcomes.
  if (activated && !subscriber.confirmedAt && newsletter.welcomeEmailEnabled) {
    try {
      const { unsubscribeUrl, headers } = newsletterUnsubscribeOptions({
        newsletterId: newsletter.id,
        subscriberId: subscriber.id,
      });
      const rendered = await renderNewsletterEmail({
        newsletter: {
          ...newsletter,
          brand: newsletterBrandSchema.parse(newsletter.brand),
        },
        issue: {
          subject: newsletter.welcomeSubject ?? newsletter.name,
          template: "TEXT",
          content: [{ type: "text", text: newsletter.welcomeBody ?? "" }],
        },
        unsubscribeUrl,
        locale,
      });
      await sendEmail({
        to: subscriber.email,
        ...rendered,
        ...newsletterSenderOptions(newsletter),
        headers,
        tag: "newsletter-welcome",
        idempotencyKey: `newsletter-welcome:${subscriber.id}`,
      });
    } catch (error) {
      captureException(error, { tags: { context: "newsletter_welcome" } });
    }
  }
  return subscriber;
}
