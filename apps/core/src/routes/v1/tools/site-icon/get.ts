import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { resolveSiteIconAsOrganizationLogo } from "@/lib/site-icon";
import {
  siteIconQuerySchema,
  siteIconResponseSchema,
} from "@/schemas/site-icon.schema";

const route = createRoute({
  method: "get",
  path: "/site-icon",
  description:
    "Scrape a website's highest-quality icon (apple-touch-icon / declared favicons / og:image), store it as an organization-logo blob under organizations/{organizationId}/logos/, and return the public URL. SSRF-guarded. Returns { url: null } when nothing usable is found. Authenticated — not an open fetch proxy. Requires organizationId.",
  tags: ["Tools"],
  request: {
    query: siteIconQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      siteIconResponseSchema,
      "The stored icon URL, or null when none could be resolved",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { url, organizationId } = c.req.valid("query");
    const iconUrl = await resolveSiteIconAsOrganizationLogo(
      url,
      organizationId,
    );

    return ok(c, siteIconResponseSchema.parse({ url: iconUrl }));
  });
}
