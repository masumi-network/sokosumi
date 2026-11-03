import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  newsletterIssueParamsSchema,
  newsletterIssueRevisionRequestSchema,
  newsletterIssueSchema,
} from "@/schemas/newsletter.schema";
import { submitNewsletterIssue } from "@/services/newsletter-issues.service";

import { newsletterIssueScope, newsletterTaskContext } from "../../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/issues/{issueId}/submit",
    tags: ["Projects"],
    description:
      "Submit a newsletter issue using its current revision. Requires access to the project workspace.",
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
    const input = c.req.valid("json");
    const issue = await submitNewsletterIssue(
      scope,
      issueId,
      input.revision,
      await newsletterTaskContext(c),
    );
    return ok(c, newsletterIssueSchema.parse(issue));
  });
}
