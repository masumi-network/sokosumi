import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { renderNewsletterUnsubscribePage } from "@sokosumi/email";
import { getEmailLocale } from "@sokosumi/utils";

import { jsonErrorResponse } from "@/helpers/openapi";
import { getNewsletterUnsubscribeSubscriber } from "@/services/newsletter-unsubscribe.service";

const route = createRoute({
  method: "get",
  path: "/unsubscribe",
  tags: ["Newsletter"],
  security: [],
  description:
    "Show an unsubscribe confirmation. GET never changes subscription state.",
  request: { query: z.object({ token: z.string().min(1).max(512) }) },
  responses: {
    200: {
      description: "Unsubscribe confirmation",
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
    const subscriber = await getNewsletterUnsubscribeSubscriber(token);
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    );
    return c.html(
      await renderNewsletterUnsubscribePage({
        name: subscriber.newsletter.name,
        actionUrl: `?token=${encodeURIComponent(token)}`,
        confirmed: false,
        locale: getEmailLocale(c.req.raw),
      }),
    );
  });
}
