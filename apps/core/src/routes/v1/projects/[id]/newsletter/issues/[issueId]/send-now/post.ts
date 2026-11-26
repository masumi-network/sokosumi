import { createRoute } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requirePersonApproval } from "@/middleware/auth";
import {
  newsletterIssueParamsSchema,
  newsletterIssueRevisionRequestSchema,
  newsletterIssueSchema,
} from "@/schemas/newsletter.schema";
import {
  getNewsletterIssue,
  scheduleNewsletterIssue,
} from "@/services/newsletter-issues.service";
import { sendNewsletterIssue } from "@/services/newsletter-send.service";

import { newsletterIssueScope, newsletterIssueWebPath } from "../../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/issues/{issueId}/send-now",
    tags: ["Projects"],
    description:
      "Send a newsletter issue now using its current revision. A person does this on a browser session; any other credential gets 403 `person_approval_required` with the issue's Web link (ADR 0077).",
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
    requirePersonApproval(
      c.var.authContext,
      newsletterIssueWebPath(id, issueId),
    );
    const input = c.req.valid("json");
    const issue = await scheduleNewsletterIssue(
      scope,
      issueId,
      input.revision,
      new Date(),
      "UTC",
      true,
    );
    try {
      await sendNewsletterIssue(issue.id);
    } catch (error) {
      // Keep the scheduled issue available to the cron worker if the inline attempt fails.
      Sentry.captureException(error);
    }
    return ok(
      c,
      newsletterIssueSchema.parse(await getNewsletterIssue(scope, issueId)),
    );
  });
}
