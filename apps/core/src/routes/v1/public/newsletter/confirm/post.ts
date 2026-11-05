import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { renderNewsletterConfirmPage } from "@sokosumi/email";
import { getEmailLocale } from "@sokosumi/utils";

import { jsonErrorResponse } from "@/helpers/openapi";
import { newsletterConfirmQuerySchema } from "@/schemas/newsletter.schema";
import { confirmNewsletterSubscriber } from "@/services/newsletter-signup.service";

const route = createRoute({
  method: "post",
  path: "/confirm",
  tags: ["Newsletter"],
  security: [],
  description:
    "Confirm a pending subscription idempotently and send its welcome email at most once.",
  request: { query: newsletterConfirmQuerySchema },
  responses: {
    200: {
      description: "Subscription confirmed",
      content: { "text/html": { schema: z.string() } },
    },
    400: jsonErrorResponse("Invalid or expired token"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { token } = c.req.valid("query");
    const locale = getEmailLocale(c.req.raw);
    const subscriber = await confirmNewsletterSubscriber(token, locale);
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    );
    return c.html(
      await renderNewsletterConfirmPage({
        name: subscriber.newsletter.name,
        actionUrl: "",
        confirmed: true,
        locale,
      }),
    );
  });
}
