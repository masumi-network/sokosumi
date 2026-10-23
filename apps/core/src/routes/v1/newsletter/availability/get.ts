import { createRoute, z } from "@hono/zod-openapi";

import { hasNewsletterBetaAccess } from "@/helpers/newsletter-beta-access";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isNewsletterEnabled } from "@/lib/newsletter/feature";

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
  app.openapi(route, async (c) => {
    const workspace = c.var.workspaceContext;
    const enabled =
      isNewsletterEnabled() &&
      workspace != null &&
      (await hasNewsletterBetaAccess(workspace.workspaceId));
    return ok(c, availabilitySchema.parse({ enabled }));
  });
}
