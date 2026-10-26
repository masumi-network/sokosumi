import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { NewsletterEventType } from "@sokosumi/database";

import { verifyEmailWebhook } from "@/clients/email.client";
import { getEnv } from "@/config/env";
import {
  serviceUnavailable,
  unauthorized,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { defaultValidationHook } from "@/lib/hono";
import { assertNewsletterEnabled } from "@/lib/newsletter/feature";

const EVENT_TYPES = new Map<string, NewsletterEventType>([
  ["email.delivered", "DELIVERED"],
  ["email.opened", "OPENED"],
  ["email.clicked", "CLICKED"],
  ["email.bounced", "BOUNCED"],
  ["email.complained", "COMPLAINED"],
]);

const eventSchema = z.object({
  created_at: z.string().pipe(z.coerce.date()),
  data: z.object({
    email_id: z.string().min(1),
    tags: z.record(z.string(), z.string()).optional(),
    click: z.object({ link: z.string().min(1) }).optional(),
    bounce: z.object({ type: z.string().optional() }).optional(),
  }),
});

const route = createRoute({
  method: "post",
  path: "/newsletter",
  tags: ["Webhooks"],
  security: [],
  description:
    "Record newsletter delivery, engagement, bounce and complaint events. Verifies the raw body with RESEND_NEWSLETTER_WEBHOOK_SECRET and the svix-id, svix-timestamp and svix-signature headers. Ignores other emails and duplicate events.",
  responses: {
    200: jsonSuccessResponse(z.object({ received: z.boolean() }), "Received"),
    401: jsonErrorResponse("Invalid webhook signature"),
    404: jsonErrorResponse("Newsletter is not enabled"),
    422: jsonErrorResponse("Invalid webhook payload"),
    500: jsonErrorResponse("Internal Server Error"),
    503: jsonErrorResponse("Newsletter webhooks are not configured"),
  },
});

const app = new OpenAPIHono({ defaultHook: defaultValidationHook });

app.openapi(route, async (c) => {
  assertNewsletterEnabled();
  const secret = getEnv().RESEND_NEWSLETTER_WEBHOOK_SECRET;
  if (!secret) {
    throw serviceUnavailable(
      "RESEND_NEWSLETTER_WEBHOOK_SECRET is required for newsletter webhooks",
    );
  }

  const id = c.req.header("svix-id") ?? "";
  const rawBody = await c.req.text();
  let payload: ReturnType<typeof verifyEmailWebhook>;
  try {
    payload = verifyEmailWebhook({
      payload: rawBody,
      headers: {
        id,
        timestamp: c.req.header("svix-timestamp") ?? "",
        signature: c.req.header("svix-signature") ?? "",
      },
      webhookSecret: secret,
    });
  } catch {
    throw unauthorized("Invalid newsletter webhook signature");
  }

  const type = EVENT_TYPES.get(payload?.type);
  if (!type) return ok(c, { received: true });
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success || (type === "CLICKED" && !parsed.data.data.click)) {
    throw unprocessableEntity("Invalid newsletter webhook payload");
  }
  const { created_at: occurredAt, data } = parsed.data;
  const send = await prisma.newsletterSend.findUnique({
    where: { providerMessageId: data.email_id },
    select: {
      id: true,
      issueId: true,
      subscriberId: true,
      issue: { select: { newsletterId: true } },
    },
  });
  if (!send) {
    // Resend can notify us before the sender persists the provider message ID.
    if (data.tags?.category === "newsletter") {
      throw serviceUnavailable("Newsletter send is not available yet");
    }
    return ok(c, { received: true });
  }

  await prisma.$transaction(async (tx) => {
    // Insert first so a duplicate never repeats subscriber side effects.
    const { count } = await tx.newsletterEvent.createMany({
      data: {
        newsletterId: send.issue.newsletterId,
        issueId: send.issueId,
        subscriberId: send.subscriberId,
        sendId: send.id,
        type,
        url: type === "CLICKED" ? data.click?.link : undefined,
        occurredAt,
        providerEventId: id,
      },
      skipDuplicates: true,
    });
    if (!count) return;

    const bounceType = data.bounce?.type?.trim().toLowerCase();
    const permanentBounce =
      type === "BOUNCED" &&
      (bounceType === undefined ||
        bounceType === "permanent" ||
        bounceType === "hard");
    if (type === "COMPLAINED" || permanentBounce) {
      await tx.newsletterSubscriber.updateMany({
        where: {
          id: send.subscriberId,
          status: { not: "UNSUBSCRIBED" },
        },
        data:
          type === "COMPLAINED"
            ? { status: "UNSUBSCRIBED", unsubscribedAt: occurredAt }
            : { status: "BOUNCED", bouncedAt: occurredAt },
      });
    }
  });
  return ok(c, { received: true });
});

export default app;
