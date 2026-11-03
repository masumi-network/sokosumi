import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  newsletterProjectParamsSchema,
  newsletterSchema,
  putNewsletterRequestSchema,
} from "@/schemas/newsletter.schema";
import { putNewsletter } from "@/services/newsletter.service";

import { newsletterScope } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/newsletter",
    tags: ["Projects"],
    description:
      "Create or replace newsletter settings for this Project. The public slug is generated on creation and preserved on update.",
    request: {
      params: newsletterProjectParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: putNewsletterRequestSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(newsletterSchema, "Newsletter saved"),
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
    const scope = await newsletterScope(c, id);
    const newsletter = await putNewsletter(scope, c.req.valid("json"));
    return ok(c, newsletterSchema.parse(newsletter));
  });
}
