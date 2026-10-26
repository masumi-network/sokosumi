import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { assertNewsletterEnabled } from "@/lib/newsletter/feature";
import { newsletterProjectParamsSchema } from "@/schemas/newsletter.schema";
import {
  newsletterAnalyticsQuerySchema,
  newsletterAnalyticsSchema,
} from "@/schemas/newsletter-analytics.schema";
import { getNewsletterAnalytics } from "@/services/newsletter-analytics.service";

import { newsletterScope } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/newsletter/analytics",
    tags: ["Projects"],
    description:
      "Newsletter activity for a project in the utxo workspace, in an inclusive UTC date range (default: last 30 days; maximum: 366). Sends use sentAt; events use occurredAt, including activity on older issues. Opens, clicks, unsubscribes, bounces and complaints count distinct subscribers across the period; daily and issue counts deduplicate within each group, so they need not sum to the period's unique counts. Delivered counts distinct sends. Rates are fractions using delivered as denominator, falling back to sent when no deliveries are recorded (zero if both are zero). Delayed events can make activity-period rates exceed 1. Growth combines retained confirmation and opt-out events with subscriber activation/departure timestamps, excludes unconfirmed opt-outs, includes a pre-range baseline, and subtracts permanent bounces as well as unsubscribes. Unsubscribes include manual changes; per-issue attribution is null. The issue table uses cursor pagination, ordered by sentAt then id descending. activeSubscribers is the current count.",
    request: {
      params: newsletterProjectParamsSchema,
      query: newsletterAnalyticsQuerySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        newsletterAnalyticsSchema,
        "Newsletter analytics",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    assertNewsletterEnabled();
    const { id } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    return ok(
      c,
      newsletterAnalyticsSchema.parse(
        await getNewsletterAnalytics(scope, c.req.valid("query")),
      ),
    );
  });
}
