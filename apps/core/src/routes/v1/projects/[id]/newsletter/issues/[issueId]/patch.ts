import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  newsletterIssueParamsSchema,
  newsletterIssueSchema,
  patchNewsletterIssueRequestSchema,
} from "@/schemas/newsletter.schema";
import { patchNewsletterIssue } from "@/services/newsletter-issues.service";

import { newsletterIssueScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}/newsletter/issues/{issueId}",
    tags: ["Projects"],
    description:
      "Edit a DRAFT or NEEDS_APPROVAL issue using its current revision. Edits return it to DRAFT and invalidate approval.",
    request: {
      params: newsletterIssueParamsSchema,

      body: {
        required: true,
        content: {
          "application/json": { schema: patchNewsletterIssueRequestSchema },
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
    const issue = await patchNewsletterIssue(
      scope,
      issueId,
      c.req.valid("json"),
    );
    return ok(c, newsletterIssueSchema.parse(issue));
  });
}
