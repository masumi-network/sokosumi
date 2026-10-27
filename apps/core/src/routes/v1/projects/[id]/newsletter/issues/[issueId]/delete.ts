import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { newsletterIssueParamsSchema } from "@/schemas/newsletter.schema";
import { deleteNewsletterIssue } from "@/services/newsletter-issues.service";

import { newsletterIssueScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/newsletter/issues/{issueId}",
    tags: ["Projects"],
    description: "Delete a DRAFT or CANCELED newsletter issue.",
    request: {
      params: newsletterIssueParamsSchema,
    },
    responses: {
      204: { description: "Newsletter issue deleted" },
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
    await deleteNewsletterIssue(scope, issueId);
    return empty(c);
  });
}
