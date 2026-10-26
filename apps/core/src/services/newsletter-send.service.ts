import { randomUUID } from "node:crypto";
import type { NewsletterIssueStatus, Prisma } from "@sokosumi/database";
import { renderNewsletterEmail } from "@sokosumi/email";
import { newsletterContentSchema } from "@sokosumi/utils";

import {
  RESEND_BATCH_MAX_SIZE,
  type SendEmailInput,
  sendEmails,
} from "@/clients/email.client";
import { conflict, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
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
import {
  newsletterBrandSchema,
  newsletterTemplateSchema,
} from "@/schemas/newsletter.schema";

const LEASE_MS = 5 * 60_000;
interface SendNewsletterIssueOptions {
  /** Trusted callers must explicitly allow any status other than SCHEDULED. */
  allowedStatus?: NewsletterIssueStatus;
  shouldContinue?: () => boolean;
}

function errorMessage(error: unknown): string {
  return (
    error instanceof Error ? error.message : "Newsletter sending failed"
  ).slice(0, 2000);
}

export async function sendNewsletterIssue(
  issueId: string,
  options: SendNewsletterIssueOptions = {},
): Promise<void> {
  assertNewsletterEnabled();
  newsletterPublicUrl("unsubscribe");
  const issue = await prisma.newsletterIssue.findUnique({
    where: { id: issueId, ...NEWSLETTER_BETA_SCOPE },
    include: { newsletter: true },
  });
  if (!issue) throw notFound("Newsletter issue not found");
  const sender = newsletterSenderOptions(issue.newsletter);
  const now = new Date();
  const recovering =
    issue.status === "SENDING" &&
    issue.leaseExpiresAt !== null &&
    issue.leaseExpiresAt <= now;
  if (!recovering && issue.status !== (options.allowedStatus ?? "SCHEDULED")) {
    throw conflict("Newsletter issue is not scheduled for sending");
  }
  // SENDING can only be recovered after its previous worker's lease expires.
  if (issue.status === "SENDING" && !recovering)
    throw conflict("Newsletter issue is already sending");
  const leaseToken = randomUUID();
  const claimed = await prisma.newsletterIssue.updateMany({
    where: {
      id: issueId,
      ...NEWSLETTER_BETA_SCOPE,
      status: issue.status,
      revision: issue.revision,
      ...(recovering
        ? { leaseToken: issue.leaseToken, leaseExpiresAt: { lte: now } }
        : {}),
    },
    data: {
      status: "SENDING",
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      lastError: null,
      revision: { increment: 1 },
    },
  });
  if (!claimed.count)
    throw conflict("Newsletter issue was claimed or changed by another worker");

  const fence = {
    id: issueId,
    status: "SENDING" as const,
    leaseToken,
    ...NEWSLETTER_BETA_SCOPE,
  };
  const sendFence: Prisma.NewsletterSendWhereInput = { issueId, issue: fence };
  async function renewLease() {
    const now = new Date();
    const result = await prisma.newsletterIssue.updateMany({
      where: { ...fence, leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (!result.count) throw conflict("Newsletter sending lease was lost");
  }

  let lastError: string | null = null;
  try {
    const newsletter = {
      ...issue.newsletter,
      brand: newsletterBrandSchema.parse(issue.newsletter.brand),
    };
    const content = newsletterContentSchema.parse(issue.content);
    const template = newsletterTemplateSchema.parse(issue.template);
    let cursor: string | undefined;
    while (true) {
      if (options.shouldContinue && !options.shouldContinue()) return;
      await renewLease();
      const page = await prisma.newsletterSubscriber.findMany({
        where: {
          newsletterId: newsletter.id,
          status: "ACTIVE",
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: RESEND_BATCH_MAX_SIZE,
      });
      if (!page.length) break;
      cursor = page[page.length - 1]?.id;
      const active = page.filter(
        (subscriber) => subscriber.status === "ACTIVE",
      );
      // Only newly reserved rows may be dispatched, including after a crash.
      // An interrupted provider request can be ambiguous; never resend that reservation.
      const reserved = active.length
        ? await prisma.newsletterSend.createManyAndReturn({
            data: active.map((subscriber) => ({
              issueId,
              subscriberId: subscriber.id,
            })),
            skipDuplicates: true,
          })
        : [];
      const inputs: SendEmailInput[] = [];
      const sends: typeof reserved = [];
      for (const send of reserved) {
        const subscriber = active.find(
          (subscriber) => subscriber.id === send.subscriberId,
        );
        if (!subscriber) continue;
        const { unsubscribeUrl, headers } = newsletterUnsubscribeOptions({
          newsletterId: newsletter.id,
          subscriberId: subscriber.id,
        });
        const rendered = await renderNewsletterEmail({
          newsletter,
          issue: { ...issue, content, template },
          unsubscribeUrl,
        });
        sends.push(send);
        inputs.push({
          to: subscriber.email,
          ...rendered,
          tag: "newsletter",
          ...sender,
          headers,
        });
      }
      if (inputs.length) {
        await renewLease();
        // Recheck consent immediately before dispatch, including unsubscribes during rendering.
        const stillActive = await prisma.newsletterSubscriber.findMany({
          where: {
            newsletterId: newsletter.id,
            id: { in: sends.map((send) => send.subscriberId) },
            status: "ACTIVE",
          },
          select: { id: true },
        });
        const activeIds = new Set(
          stillActive.map((subscriber) => subscriber.id),
        );
        const deliverable = sends.flatMap((send, index) =>
          activeIds.has(send.subscriberId)
            ? [{ send, input: inputs[index]! }]
            : [],
        );
        const skippedIds = sends
          .filter((send) => !activeIds.has(send.subscriberId))
          .map((send) => send.id);
        if (skippedIds.length)
          await prisma.newsletterSend.updateMany({
            where: { ...sendFence, id: { in: skippedIds } },
            data: { status: "FAILED", error: "Subscriber is no longer active" },
          });
        if (deliverable.length) {
          if (options.shouldContinue && !options.shouldContinue()) {
            // No provider call was attempted, so these reservations are safe to retry.
            await prisma.newsletterSend.deleteMany({
              where: {
                ...sendFence,
                id: { in: reserved.map((send) => send.id) },
                status: "QUEUED",
              },
            });
            return;
          }
          await renewLease();
          let results: { id: string }[] | undefined;
          try {
            results = await sendEmails(deliverable.map(({ input }) => input));
          } catch (error) {
            lastError = errorMessage(error);
            await prisma.newsletterSend.updateMany({
              where: {
                ...sendFence,
                id: { in: deliverable.map(({ send }) => send.id) },
              },
              data: { status: "FAILED", error: lastError },
            });
          }
          if (results) {
            await prisma.$transaction(
              deliverable.map(({ send }, index) =>
                prisma.newsletterSend.updateMany({
                  where: { ...sendFence, id: send.id, status: "QUEUED" },
                  data: {
                    status: "SENT",
                    providerMessageId: results[index]!.id,
                    sentAt: new Date(),
                    error: null,
                  },
                }),
              ),
            );
          }
        }
      }
      if (page.length < RESEND_BATCH_MAX_SIZE) break;
    }
  } catch (error) {
    lastError = errorMessage(error);
  }

  await renewLease();
  await prisma.newsletterSend.updateMany({
    where: { ...sendFence, status: "QUEUED" },
    data: {
      status: "FAILED",
      error:
        lastError ??
        "Interrupted send; delivery could not be confirmed and will not be retried",
    },
  });
  const sent = await prisma.newsletterSend.count({
    where: { issueId, status: "SENT" },
  });
  const failed = await prisma.newsletterSend.count({
    where: { issueId, status: "FAILED" },
  });
  const result = await prisma.newsletterIssue.updateMany({
    where: { ...fence, leaseExpiresAt: { gt: new Date() } },
    data: {
      status: sent ? "SENT" : "FAILED",
      sentAt: sent ? new Date() : null,
      lastError:
        lastError ??
        (failed
          ? `${failed} newsletter sends failed`
          : sent
            ? null
            : "No active subscribers could be sent this issue"),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  if (!result.count) throw conflict("Newsletter sending lease was lost");
}

export async function sendDueNewsletterIssues(
  options: Pick<SendNewsletterIssueOptions, "shouldContinue"> = {},
) {
  if (!isNewsletterEnabled()) return;
  const now = new Date();
  const issues = await prisma.newsletterIssue.findMany({
    where: {
      ...NEWSLETTER_BETA_SCOPE,
      OR: [
        { status: "SCHEDULED", scheduledAt: { lte: now } },
        { status: "SENDING", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: 10,
    select: { id: true },
  });
  for (const issue of issues) {
    if (options.shouldContinue && !options.shouldContinue()) break;
    await sendNewsletterIssue(issue.id, options);
  }
}
