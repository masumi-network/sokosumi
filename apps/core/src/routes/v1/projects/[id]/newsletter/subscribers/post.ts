import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  addNewsletterSubscriberRequestSchema,
  newsletterProjectParamsSchema,
  newsletterSubscriberSchema,
} from "@/schemas/newsletter.schema";
import { addNewsletterSubscriber } from "@/services/newsletter.service";

import { newsletterScope, newsletterSubscriberAdder } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/newsletter/subscribers",
    tags: ["Projects"],
    description:
      "Add a subscriber by hand. CONFIRMED records existing consent; ASK sends a double opt-in email. Existing emails return 409. Unsubscribed and bounced subscribers are never reactivated.",
    request: {
      params: newsletterProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: addNewsletterSubscriberRequestSchema },
        },
      },
    },
    responses: {
      201: jsonSuccessResponse(newsletterSubscriberSchema, "Subscriber added"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
      429: jsonErrorResponse("Confirmation request limit exceeded"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    const subscriber = await addNewsletterSubscriber(
      scope,
      c.req.valid("json"),
      await newsletterSubscriberAdder(c, scope),
    );
    return created(c, newsletterSubscriberSchema.parse(subscriber));
  });
}
