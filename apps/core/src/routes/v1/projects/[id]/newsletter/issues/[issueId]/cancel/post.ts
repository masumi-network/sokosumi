import { createRoute } from "@hono/zod-openapi";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { isSokoBotAuthContext } from "@/middleware/auth";
import {
  newsletterIssueParamsSchema,
  newsletterIssueRevisionRequestSchema,
  newsletterIssueSchema,
} from "@/schemas/newsletter.schema";
import { cancelNewsletterIssue } from "@/services/newsletter-issues.service";

import { newsletterIssueScope } from "../../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/issues/{issueId}/cancel",
    tags: ["Projects"],
    description:
      "Cancel a scheduled newsletter issue using its current revision: it goes back to a draft that needs approval again. Allowed to a person and to agents (API key, OAuth or MCP token, Coworker); not to Soko Bots.",
    request: {
      params: newsletterIssueParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: newsletterIssueRevisionRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        newsletterIssueSchema,
        "Newsletter issue updated",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id, issueId } = c.req.valid("param");
    const scope = await newsletterIssueScope(c, id);
    // ADR 0077: anyone may stop a send. Soko Bots keep their own rules (ADR 0073).
    if (isSokoBotAuthContext(c.var.authContext)) {
      throw forbidden("A Soko Bot cannot cancel a newsletter issue");
    }
    const input = c.req.valid("json");
    const issue = await cancelNewsletterIssue(scope, issueId, input.revision);
    return ok(c, newsletterIssueSchema.parse(issue));
  });
}
