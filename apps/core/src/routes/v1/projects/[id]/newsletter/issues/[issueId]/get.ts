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
} from "@/schemas/newsletter.schema";
import { getNewsletterIssue } from "@/services/newsletter-issues.service";

import { newsletterIssueScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/newsletter/issues/{issueId}",
    tags: ["Projects"],
    description: "Get a newsletter issue belonging to this Project.",
    request: {
      params: newsletterIssueParamsSchema,
    },
    responses: {
      200: jsonSuccessResponse(newsletterIssueSchema, "Newsletter issue"),
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
    const issue = await getNewsletterIssue(scope, issueId);
    return ok(c, newsletterIssueSchema.parse(issue));
  });
}
