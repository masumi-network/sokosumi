import { createRoute, z } from "@hono/zod-openapi";

import { getEnv } from "@/config/env";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const availabilitySchema = z
  .object({ enabled: z.boolean() })
  .openapi("NewsletterAvailability");

const route = createRoute({
  method: "get",
  path: "/availability",
  tags: ["Newsletter"],
  description:
    "Read newsletter availability, including when newsletters are disabled.",
  responses: {
    200: jsonSuccessResponse(availabilitySchema, "Newsletter availability"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, (c) => {
    return ok(
      c,
      availabilitySchema.parse({ enabled: getEnv().NEWSLETTER_ENABLED }),
    );
  });
}
