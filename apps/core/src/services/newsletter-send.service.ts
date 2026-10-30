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
import { serializableTransaction } from "@/lib/db/transaction";
import {
  newsletterPublicUrl,
  newsletterUnsubscribeOptions,
} from "@/lib/newsletter/email";
import { NEWSLETTER_BETA_SCOPE } from "@/lib/newsletter/feature";
import {
  compareWarmupRecipients,
  utcDay,
  warmupDailyCap,
  warmupDay,
} from "@/lib/newsletter/sending-domain-warmup";
import {
  newsletterBrandSchema,
  newsletterTemplateSchema,
} from "@/schemas/newsletter.schema";
import { resolveNewsletterSendingContext } from "@/services/newsletter-sending-domain.service";
import { pauseNewsletterSendingDomainIfUnhealthy } from "@/services/newsletter-sending-domain-warmup.service";

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
  newsletterPublicUrl("unsubscribe");
  const issue = await prisma.newsletterIssue.findUnique({
    where: { id: issueId, ...NEWSLETTER_BETA_SCOPE },
    include: { newsletter: true },
  });
  if (!issue) throw notFound("Newsletter issue not found");
  const { sender, domain } = await resolveNewsletterSendingContext(
    issue.newsletter,
  );
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
  let retryAt = new Date(Date.now() + LEASE_MS);
  try {
    // Only newly reserved rows may be dispatched, including after a crash.
    // An interrupted provider request can be ambiguous; never resend that reservation.
    await prisma.newsletterSend.updateMany({
      where: { ...sendFence, status: "QUEUED", attemptedAt: { not: null } },
      data: {
        status: "FAILED",
        error:
          "Interrupted send; delivery could not be confirmed and will not be retried",
      },
    });
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
      await prisma.newsletterSend.createManyAndReturn({
        data: page.map((subscriber) => ({
          issueId,
          subscriberId: subscriber.id,
          attemptedAt: null,
        })),
        skipDuplicates: true,
      });
      if (page.length < RESEND_BATCH_MAX_SIZE) break;
    }
    const queued = await prisma.newsletterSend.findMany({
      where: { ...sendFence, status: "QUEUED", attemptedAt: null },
      include: {
        subscriber: {
          include: {
            events: {
              where: { type: { in: ["OPENED", "CLICKED"] } },
              orderBy: { occurredAt: "desc" },
              take: 1,
              select: { occurredAt: true },
            },
          },
        },
      },
    });
    if (domain) {
      queued.sort((a, b) =>
        compareWarmupRecipients(
          {
            ...a.subscriber,
            lastEngagedAt: a.subscriber.events[0]?.occurredAt ?? null,
          },
          {
            ...b.subscriber,
            lastEngagedAt: b.subscriber.events[0]?.occurredAt ?? null,
          },
        ),
      );
    }
    for (
      let offset = 0;
      offset < queued.length;
      offset += RESEND_BATCH_MAX_SIZE
    ) {
      if (options.shouldContinue && !options.shouldContinue()) return;
      await renewLease();
      const batch = queued.slice(offset, offset + RESEND_BATCH_MAX_SIZE);
      const inputs: SendEmailInput[] = [];
      for (const send of batch) {
        const { unsubscribeUrl, headers } = newsletterUnsubscribeOptions({
          newsletterId: newsletter.id,
          subscriberId: send.subscriberId,
        });
        const rendered = await renderNewsletterEmail({
          newsletter,
          issue: { ...issue, content, template },
          unsubscribeUrl,
        });
        inputs.push({
          to: send.subscriber.email,
          ...rendered,
          tag: "newsletter",
          ...sender,
          headers,
        });
      }
      // Recheck consent immediately before dispatch, including unsubscribes during rendering.
      const stillActive = await prisma.newsletterSubscriber.findMany({
        where: {
          newsletterId: newsletter.id,
          id: { in: batch.map((send) => send.subscriberId) },
          status: "ACTIVE",
        },
        select: { id: true },
      });
      const activeIds = new Set(stillActive.map((subscriber) => subscriber.id));
      const deliverable = batch.flatMap((send, index) =>
        activeIds.has(send.subscriberId)
          ? [{ send, input: inputs[index]! }]
          : [],
      );
      const skippedIds = batch
        .filter((send) => !activeIds.has(send.subscriberId))
        .map((send) => send.id);
      if (skippedIds.length)
        await prisma.newsletterSend.updateMany({
          where: {
            ...sendFence,
            id: { in: skippedIds },
            status: "QUEUED",
            attemptedAt: null,
          },
          data: { status: "FAILED", error: "Subscriber is no longer active" },
        });
      if (!deliverable.length) continue;
      if (options.shouldContinue && !options.shouldContinue()) {
        // No provider call was attempted, so these reservations are safe to retry.
        return;
      }
      const reservation = await serializableTransaction(async (tx) => {
        const attemptedAt = new Date();
        const lease = await tx.newsletterIssue.updateMany({
          where: { ...fence, leaseExpiresAt: { gt: attemptedAt } },
          data: { leaseExpiresAt: new Date(attemptedAt.getTime() + LEASE_MS) },
        });
        if (!lease.count) throw conflict("Newsletter sending lease was lost");
        let count = deliverable.length;
        if (domain) {
          const current = await tx.newsletterSendingDomain.findUnique({
            where: { id: domain.id },
          });
          if (
            !current ||
            current.status !== "VERIFIED" ||
            current.projectId !== newsletter.projectId ||
            current.warmupPausedAt
          ) {
            return {
              count: 0,
              reason:
                "Newsletter sending domain warm-up is paused or the domain is unavailable. Resume it in Newsletter settings.",
              retryAt: new Date(attemptedAt.getTime() + LEASE_MS),
            };
          }
          const day = utcDay(attemptedAt);
          const cap = current.warmupStartedAt
            ? warmupDailyCap(warmupDay(current.warmupStartedAt, attemptedAt))
            : null;
          const used =
            current.warmupSentOnDayUtc?.getTime() === day.getTime()
              ? current.warmupSentCount
              : 0;
          count = Math.min(
            count,
            cap === null ? count : Math.max(0, cap - used),
          );
          if (!count)
            return {
              count: 0,
              reason: "Newsletter sending domain daily warm-up limit reached",
              retryAt: new Date(day.getTime() + 86_400_000),
            };
          await tx.newsletterSendingDomain.update({
            where: { id: current.id },
            data: { warmupSentOnDayUtc: day, warmupSentCount: used + count },
          });
        }
        const reserved = await tx.newsletterSend.updateMany({
          where: {
            ...sendFence,
            id: { in: deliverable.slice(0, count).map(({ send }) => send.id) },
            status: "QUEUED",
            attemptedAt: null,
          },
          data: { attemptedAt, sendingDomainId: domain?.id ?? null },
        });
        if (reserved.count !== count)
          throw conflict("Newsletter sending reservation changed");
        return {
          count,
          reason: null,
          retryAt: new Date(attemptedAt.getTime() + LEASE_MS),
        };
      }, "Newsletter sending domain capacity changed; retry sending");
      if (!reservation.count) {
        lastError = reservation.reason;
        retryAt = reservation.retryAt;
        break;
      }
      const reserved = deliverable.slice(0, reservation.count);
      let results: { id: string }[] | undefined;
      try {
        results = await sendEmails(reserved.map(({ input }) => input));
      } catch (error) {
        lastError = errorMessage(error);
        await prisma.newsletterSend.updateMany({
          where: {
            ...sendFence,
            id: { in: reserved.map(({ send }) => send.id) },
          },
          data: { status: "FAILED", error: lastError },
        });
      }
      if (results) {
        await prisma.$transaction(
          reserved.map(({ send }, index) =>
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
      if (domain) await pauseNewsletterSendingDomainIfUnhealthy(domain.id);
      if (reservation.count < deliverable.length) {
        retryAt = new Date(utcDay(new Date()).getTime() + 86_400_000);
        lastError = "Newsletter sending domain daily warm-up limit reached";
        break;
      }
    }
  } catch (error) {
    lastError = errorMessage(error);
  }

  await renewLease();
  await prisma.newsletterSend.updateMany({
    where: { ...sendFence, status: "QUEUED", attemptedAt: { not: null } },
    data: {
      status: "FAILED",
      error:
        lastError ??
        "Interrupted send; delivery could not be confirmed and will not be retried",
    },
  });
  const queued = await prisma.newsletterSend.count({
    where: { ...sendFence, status: "QUEUED", attemptedAt: null },
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
      status: queued ? "SENDING" : sent ? "SENT" : "FAILED",
      sentAt: !queued && sent ? new Date() : null,
      lastError:
        lastError ??
        (failed
          ? `${failed} newsletter sends failed`
          : sent || queued
            ? null
            : "No active subscribers could be sent this issue"),
      leaseToken: null,
      leaseExpiresAt: queued ? retryAt : null,
    },
  });
  if (!result.count) throw conflict("Newsletter sending lease was lost");
}

export async function sendDueNewsletterIssues(
  options: Pick<SendNewsletterIssueOptions, "shouldContinue"> = {},
) {
  const now = new Date();
  const issues = await prisma.newsletterIssue.findMany({
    where: {
      ...NEWSLETTER_BETA_SCOPE,
      OR: [
        { status: "SCHEDULED", scheduledAt: { lte: now } },
        { status: "SENDING", leaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: [{ leaseExpiresAt: "asc" }, { scheduledAt: "asc" }, { id: "asc" }],
    take: 10,
    select: { id: true },
  });
  for (const issue of issues) {
    if (options.shouldContinue && !options.shouldContinue()) break;
    await sendNewsletterIssue(issue.id, options);
  }
}
