import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { renderNewsletterEmail } from "@sokosumi/email";

import { getEnv } from "@/config/env";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { NEWSLETTER_BETA_SCOPE } from "@/lib/newsletter/feature";
import {
  createNewsletterIssueRequestSchema,
  newsletterBrandSchema,
  publicNewsletterIssueParamsSchema,
  publicNewsletterIssueSchema,
} from "@/schemas/newsletter.schema";

const route = createRoute({
  method: "get",
  path: "/{publicSlug}/issues/{issueSlug}",
  tags: ["Newsletter"],
  security: [],
  description:
    "Read a sent issue rendered for the web, without subscriber data or tracking.",
  request: {
    params: publicNewsletterIssueParamsSchema,
    query: z.object({ locale: z.enum(["en", "de", "es"]).default("en") }),
  },
  responses: {
    200: jsonSuccessResponse(
      publicNewsletterIssueSchema,
      "Public newsletter issue",
    ),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { publicSlug, issueSlug } = c.req.valid("param");
    const issue = await prisma.newsletterIssue.findFirst({
      where: {
        publicSlug: issueSlug,
        newsletter: { publicSlug, ...NEWSLETTER_BETA_SCOPE },
        status: "SENT",
        sentAt: { not: null },
      },
      select: {
        subject: true,
        previewText: true,
        sentAt: true,
        template: true,
        content: true,
        newsletter: { select: { name: true, brand: true } },
      },
    });
    if (!issue) throw notFound("Newsletter issue not found");

    const { html } = await renderNewsletterEmail({
      mode: "web",
      newsletter: {
        name: issue.newsletter.name,
        brand: newsletterBrandSchema.parse(issue.newsletter.brand),
      },
      issue: createNewsletterIssueRequestSchema.parse(issue),
      subscribeUrl: new URL(
        `/n/${encodeURIComponent(publicSlug)}`,
        getEnv().WEB_APP_BASE_URL,
      ).href,
      locale: c.req.valid("query").locale,
    });
    c.header("Cache-Control", "public, s-maxage=300");
    return ok(c, publicNewsletterIssueSchema.parse({ ...issue, html }));
  });
}
