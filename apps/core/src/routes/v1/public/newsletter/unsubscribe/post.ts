import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { renderNewsletterUnsubscribePage } from "@sokosumi/email";
import { getEmailLocale } from "@sokosumi/utils";

import { jsonErrorResponse } from "@/helpers/openapi";
import { unsubscribeNewsletterSubscriber } from "@/services/newsletter-unsubscribe.service";

const route = createRoute({
  method: "post",
  path: "/unsubscribe",
  tags: ["Newsletter"],
  security: [],
  description:
    "Unsubscribe idempotently. Accepts confirmation forms and RFC 8058 one-click POSTs without authentication.",
  request: { query: z.object({ token: z.string().min(1).max(512) }) },
  responses: {
    200: {
      description: "Unsubscribed",
      content: { "text/html": { schema: z.string() } },
    },
    400: jsonErrorResponse("Invalid token"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const { token } = c.req.valid("query");
    const subscriber = await unsubscribeNewsletterSubscriber(token);
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    return c.html(
      await renderNewsletterUnsubscribePage({
        name: subscriber.newsletter.name,
        actionUrl: "",
        confirmed: true,
        locale: getEmailLocale(c.req.raw),
      }),
    );
  });
}
