import { createRoute } from "@hono/zod-openapi";

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
  listNewsletterSubscribersQuerySchema,
  newsletterProjectParamsSchema,
  newsletterSubscriberListSchema,
} from "@/schemas/newsletter.schema";
import { listNewsletterSubscribers } from "@/services/newsletter.service";

import { newsletterScope } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/newsletter/subscribers",
    tags: ["Projects"],
    description:
      "List newsletter subscribers by status and email search, with cursor pagination. Counts cover all subscribers in this newsletter, regardless of filters.",
    request: {
      params: newsletterProjectParamsSchema,
      query: listNewsletterSubscribersQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(
        newsletterSubscriberListSchema,
        "Newsletter subscribers and status counts",
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
    const { id } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    const { pagination, ...data } = await listNewsletterSubscribers(
      scope,
      c.req.valid("query"),
    );
    return ok(c, newsletterSubscriberListSchema.parse(data), pagination);
  });
}
