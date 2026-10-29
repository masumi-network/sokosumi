import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  createNewsletterIssueRequestSchema,
  newsletterIssueSchema,
  newsletterProjectParamsSchema,
} from "@/schemas/newsletter.schema";
import { createNewsletterIssue } from "@/services/newsletter-issues.service";

import { newsletterIssueScope } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/issues",
    tags: ["Projects"],
    description:
      "Create a draft newsletter issue. Creating an issue never schedules or sends it.",
    request: {
      params: newsletterProjectParamsSchema,

      body: {
        required: true,
        content: {
          "application/json": { schema: createNewsletterIssueRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(
        newsletterIssueSchema,
        "Newsletter issue created",
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
    const issue = await createNewsletterIssue(scope, c.req.valid("json"));
    return created(c, newsletterIssueSchema.parse(issue));
  });
}
