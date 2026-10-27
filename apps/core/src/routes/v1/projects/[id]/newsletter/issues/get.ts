import { createRoute, z } from "@hono/zod-openapi";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  listNewsletterIssuesQuerySchema,
  newsletterIssueSchema,
  newsletterProjectParamsSchema,
} from "@/schemas/newsletter.schema";
import { listNewsletterIssues } from "@/services/newsletter-issues.service";

import { newsletterIssueScope } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/newsletter/issues",
    tags: ["Projects"],
    description:
      "List this Project's newsletter issues, optionally filtered by status.",
    request: {
      params: newsletterProjectParamsSchema,
      query: listNewsletterIssuesQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        z.array(newsletterIssueSchema),
        "Newsletter issues",
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
    const { id } = c.req.valid("param");
    const scope = await newsletterIssueScope(c, id);
    const { pagination, issues } = await listNewsletterIssues(
      scope,
      c.req.valid("query"),
    );
    return ok(
      c,
      issues.map((issue) => newsletterIssueSchema.parse(issue)),
      pagination,
    );
  });
}
