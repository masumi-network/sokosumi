import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { assertNewsletterEnabled } from "@/lib/newsletter/feature";
import { newsletterIssueParamsSchema } from "@/schemas/newsletter.schema";
import { newsletterIssueAnalyticsSchema } from "@/schemas/newsletter-analytics.schema";
import { getNewsletterIssueAnalytics } from "@/services/newsletter-analytics.service";

import { newsletterScope } from "../../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/newsletter/issues/{issueId}/analytics",
    tags: ["Projects"],
    description:
      "Lifetime analytics for one newsletter issue in the utxo workspace. Unsubscribes are null because unsubscribe links do not identify an issue. Engagement counts distinct subscribers; deliveries count distinct sends. Rates are fractions using delivered sends, falling back to sent when delivered is zero (zero if both are zero). activeSubscribers is the newsletter's current count. Top links are the 20 most clicked URLs, each deduplicated per subscriber, ordered by uniqueClicks then URL.",
    request: { params: newsletterIssueParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        newsletterIssueAnalyticsSchema,
        "Newsletter issue analytics",
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
    const { id, issueId } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    return ok(
      c,
      newsletterIssueAnalyticsSchema.parse(
        await getNewsletterIssueAnalytics(scope, issueId),
      ),
    );
  });
}
