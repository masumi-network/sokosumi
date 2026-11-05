import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";

import { jsonContent, jsonErrorResponse } from "@/helpers/openapi";
import { accepted } from "@/helpers/response";
import {
  newsletterSignupAcceptedSchema,
  publicNewsletterParamsSchema,
  subscribeNewsletterRequestSchema,
} from "@/schemas/newsletter.schema";
import { subscribeToNewsletter } from "@/services/newsletter-signup.service";

const route = createRoute({
  method: "post",
  path: "/{publicSlug}/subscribe",
  tags: ["Newsletter"],
  security: [],
  description:
    "Request double opt-in. All subscription states, honeypots and throttled requests receive the same acknowledgment.",
  request: {
    params: publicNewsletterParamsSchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: subscribeNewsletterRequestSchema },
      },
    },
  },
  responses: {
    202: {
      description: "Check your inbox",
      content: jsonContent(newsletterSignupAcceptedSchema),
    },
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { publicSlug } = c.req.valid("param");
    await subscribeToNewsletter(publicSlug, c.req.valid("json"), c.req.raw);
    c.header("Cache-Control", "no-store");
    // Embeds use a fixed acknowledgment without request metadata.
    return accepted(
      c,
      newsletterSignupAcceptedSchema.parse({ status: "check_your_inbox" }),
    );
  });
}
