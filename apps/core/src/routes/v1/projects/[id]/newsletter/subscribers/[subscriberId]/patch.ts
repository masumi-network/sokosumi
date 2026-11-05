import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  newsletterSubscriberParamsSchema,
  newsletterSubscriberSchema,
  patchNewsletterSubscriberRequestSchema,
} from "@/schemas/newsletter.schema";
import { patchNewsletterSubscriber } from "@/services/newsletter.service";

import { newsletterScope } from "../../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "patch",
    path: "/{id}/newsletter/subscribers/{subscriberId}",
    tags: ["Projects"],
    description:
      "Change a subscriber's name or unsubscribe an active subscriber. Unsubscribed, pending and bounced subscribers cannot change status manually.",
    request: {
      params: newsletterSubscriberParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": {
            schema: patchNewsletterSubscriberRequestSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        newsletterSubscriberSchema,
        "Subscriber updated",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Invalid status transition"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { id, subscriberId } = c.req.valid("param");
    const scope = await newsletterScope(c, id);
    const subscriber = await patchNewsletterSubscriber(
      scope,
      subscriberId,
      c.req.valid("json"),
    );
    return ok(c, newsletterSubscriberSchema.parse(subscriber));
  });
}
