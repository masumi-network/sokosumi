import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { newsletterSubscriberParamsSchema } from "@/schemas/newsletter.schema";
import { deleteNewsletterSubscriber } from "@/services/newsletter.service";

import { newsletterScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}/newsletter/subscribers/{subscriberId}",
    tags: ["Projects"],
    description:
      "Delete an active or pending subscriber from this Project's newsletter. Unsubscribed and bounced subscribers are retained to prevent reactivation and return 409.",
    request: { params: newsletterSubscriberParamsSchema },
    responses: {
      204: { description: "Subscriber deleted" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Suppressed subscriber must be retained"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id, subscriberId } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    await deleteNewsletterSubscriber(scope, subscriberId);
    return empty(c);
  });
}
