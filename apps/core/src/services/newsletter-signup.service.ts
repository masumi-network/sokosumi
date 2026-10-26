import { captureException } from "@sentry/node";
import {
  renderNewsletterConfirmationEmail,
  renderNewsletterEmail,
} from "@sokosumi/email";
import { contactNameFromChannel } from "@sokosumi/utils";

import { sendEmail } from "@/clients/email.client";
import { getEnv } from "@/config/env";
import { badRequest, notFound, unprocessableEntity } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
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
import {
  assertNewsletterEnabled,
  isNewsletterEnabled,
  NEWSLETTER_BETA_SCOPE,
} from "@/lib/newsletter/feature";
import { allowNewsletterSignup } from "@/lib/newsletter/signup-limit";
import {
  newsletterBrandSchema,
  type SubscribeNewsletterRequest,
} from "@/schemas/newsletter.schema";
import { contactListNameKey } from "@/services/contact-lists.service";

const CONFIRMATION_RESEND_MS = 10 * 60_000;
const WELCOME_LEASE_MS = 5 * 60_000;

export async function getPublicNewsletter(publicSlug: string) {
  assertNewsletterEnabled();
  const newsletter = await prisma.newsletter.findUnique({
    where: { publicSlug, ...NEWSLETTER_BETA_SCOPE },
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
    where: { publicSlug, ...NEWSLETTER_BETA_SCOPE },
  });
  if (!newsletter) throw notFound("Newsletter not found");
  if (!(await allowNewsletterSignup(newsletter.id, request))) return;

  const now = new Date();
  const reserveSignup = () =>
    prisma.$transaction(async (tx) => {
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
          newsletterId_email: {
            newsletterId: newsletter.id,
            email: input.email,
          },
        },
      });
      if (!subscriber) return null;
      if (
        subscriber.status !== "PENDING" ||
        subscriber.unsubscribedAt ||
        subscriber.bouncedAt
      )
        return null;
      if (!created) {
        if (
          subscriber.consentAt &&
          subscriber.consentAt.getTime() >
            now.getTime() - CONFIRMATION_RESEND_MS
        )
          return null;
        // Reserve dispatch atomically; consentAt also invalidates older opt-in links.
        const { count } = await tx.newsletterSubscriber.updateMany({
          where: {
            id: subscriber.id,
            status: "PENDING",
            consentAt: subscriber.consentAt,
            unsubscribedAt: null,
            bouncedAt: null,
          },
          data: {
            status: "PENDING",
            consentAt: now,
            source: "SIGNUP_FORM",
            name: input.name,
          },
        });
        if (!count) return null;
      }
      const channel = await tx.contactChannel.upsert({
        where: {
          workspaceId_type_value: {
            workspaceId: newsletter.workspaceId,
            type: "EMAIL",
            value: input.email,
          },
        },
        create: {
          workspaceId: newsletter.workspaceId,
          type: "EMAIL",
          value: input.email,
          source: "OTHER",
          isPrimary: true,
          contact: {
            create: {
              workspaceId: newsletter.workspaceId,
              name: input.name || contactNameFromChannel("EMAIL", input.email),
            },
          },
        },
        update: {},
        select: { contactId: true },
      });
      const name = `${newsletter.name} subscribers`;
      const nameKey = contactListNameKey(name);
      const list = await tx.contactList.upsert({
        where: {
          workspaceId_nameKey: { workspaceId: newsletter.workspaceId, nameKey },
        },
        create: {
          workspaceId: newsletter.workspaceId,
          name,
          nameKey,
          color: "gray",
        },
        update: {},
        select: { id: true, smartFilter: true },
      });
      if (list.smartFilter)
        throw unprocessableEntity(`"${name}" is a smart list`);
      await tx.contactListMember.createMany({
        data: { listId: list.id, contactId: channel.contactId },
        skipDuplicates: true,
      });
      if (created)
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
  // Nested Contact upserts can race across newsletters sharing the same email.
  const subscriber = await reserveSignup()
    .catch((error: unknown) => {
      if (!isPrismaUniqueViolation(error)) throw error;
      return reserveSignup();
    })
    .catch((error: unknown) => {
      // Persistence failures must not disclose which addresses need confirmation.
      captureException(error, { tags: { context: "newsletter_confirmation" } });
      return null;
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
    const pending = await prisma.newsletterSubscriber.findUnique({
      where: {
        id: subscriber.id,
        newsletterId: newsletter.id,
        newsletter: NEWSLETTER_BETA_SCOPE,
        status: "PENDING",
        consentAt: now,
        unsubscribedAt: null,
        bouncedAt: null,
      },
      select: { id: true },
    });
    if (!pending) return;
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
      newsletter: NEWSLETTER_BETA_SCOPE,
    },
    include: { newsletter: true },
  });
  if (!subscriber) throw notFound("Subscriber not found");
  if (subscriber.consentAt?.getTime() !== consentAt) {
    throw badRequest("Invalid or expired confirmation token");
  }
  if (
    (subscriber.status !== "PENDING" && subscriber.status !== "ACTIVE") ||
    subscriber.unsubscribedAt ||
    subscriber.bouncedAt
  ) {
    throw badRequest("This subscription cannot be confirmed");
  }
  return subscriber;
}

export async function confirmNewsletterSubscriber(
  token: string,
  locale: string,
) {
  let subscriber = await getNewsletterConfirmSubscriber(token);
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
  if (!activated) {
    subscriber = await getNewsletterConfirmSubscriber(token);
    if (subscriber.status !== "ACTIVE") {
      throw badRequest("This subscription cannot be confirmed");
    }
  }
  const newsletter = subscriber.newsletter;
  if (!subscriber.welcomeSentAt && newsletter.welcomeEmailEnabled) {
    const now = new Date();
    const welcomeLeaseExpiresAt = new Date(now.getTime() + WELCOME_LEASE_MS);
    const welcomeWhere = {
      id: subscriber.id,
      newsletterId: newsletter.id,
      newsletter: { ...NEWSLETTER_BETA_SCOPE, welcomeEmailEnabled: true },
      status: "ACTIVE" as const,
      consentAt: subscriber.consentAt,
      unsubscribedAt: null,
      bouncedAt: null,
      welcomeSentAt: null,
    };
    try {
      const { count } = await prisma.newsletterSubscriber.updateMany({
        where: {
          ...welcomeWhere,
          OR: [
            { welcomeLeaseExpiresAt: null },
            { welcomeLeaseExpiresAt: { lte: now } },
          ],
        },
        data: { welcomeLeaseExpiresAt },
      });
      if (!count) return subscriber;
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
        const active = await prisma.newsletterSubscriber.findUnique({
          where: {
            ...welcomeWhere,
            welcomeLeaseExpiresAt: {
              equals: welcomeLeaseExpiresAt,
              gt: new Date(),
            },
          },
          select: { id: true },
        });
        if (!active || !isNewsletterEnabled()) return subscriber;
        await sendEmail({
          to: subscriber.email,
          ...rendered,
          ...newsletterSenderOptions(newsletter),
          headers,
          tag: "newsletter-welcome",
          idempotencyKey: `newsletter-welcome:${subscriber.id}`,
        });
        await prisma.newsletterSubscriber.updateMany({
          where: {
            id: subscriber.id,
            welcomeLeaseExpiresAt,
            welcomeSentAt: null,
          },
          data: { welcomeSentAt: new Date() },
        });
      } finally {
        // The expiry also fences cleanup against a newer confirmation's claim.
        await prisma.newsletterSubscriber.updateMany({
          where: { id: subscriber.id, welcomeLeaseExpiresAt },
          data: { welcomeLeaseExpiresAt: null },
        });
      }
    } catch (error) {
      captureException(error, { tags: { context: "newsletter_welcome" } });
    }
  }
  return subscriber;
}
