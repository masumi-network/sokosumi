import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { NEWSLETTER_BETA_SCOPE } from "@/lib/newsletter/feature";
import {
  listPublicNewsletterIssuesQuerySchema,
  publicNewsletterIssueSummarySchema,
  publicNewsletterParamsSchema,
} from "@/schemas/newsletter.schema";

const route = createRoute({
  method: "get",
  path: "/{publicSlug}/issues",
  tags: ["Newsletter"],
  security: [],
  description:
    "List sent newsletter issues, newest first, without subscriber data.",
  request: {
    params: publicNewsletterParamsSchema,
    query: listPublicNewsletterIssuesQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      z.array(publicNewsletterIssueSummarySchema),
      "Public newsletter archive",
    ),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { publicSlug } = c.req.valid("param");
    const newsletter = await prisma.newsletter.findUnique({
      where: { publicSlug, ...NEWSLETTER_BETA_SCOPE },
      select: { id: true },
    });
    if (!newsletter) throw notFound("Newsletter not found");

    const { cursor, take, skip } = parseCursorPagination(c.req.valid("query"));
    const where = {
      newsletterId: newsletter.id,
      status: "SENT" as const,
      sentAt: { not: null },
    };
    const [issues, total] = await Promise.all([
      prisma.newsletterIssue.findMany({
        where,
        select: {
          id: true,
          publicSlug: true,
          subject: true,
          previewText: true,
          sentAt: true,
        },
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        cursor: cursor ? { id: cursor } : undefined,
        take: take + 1,
        skip,
      }),
      prisma.newsletterIssue.count({ where }),
    ]);
    const page = issues.slice(0, take);
    const pagination = createPaginationMeta(
      page,
      total,
      take,
      issues.length > take,
      cursor,
    );
    c.header("Cache-Control", "public, s-maxage=300");
    return ok(
      c,
      z.array(publicNewsletterIssueSummarySchema).parse(page),
      pagination,
    );
  });
}
