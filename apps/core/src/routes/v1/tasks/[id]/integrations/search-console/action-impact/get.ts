import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  seoImpactDaysSchema,
  seoTaskActionImpactSchema,
} from "@/schemas/seo-action-impact.schema";
import { readSeoTaskActionImpact } from "@/services/seo-task-action-impact";

const route = createRoute({
  method: "get",
  path: "/{id}/integrations/search-console/action-impact",
  tags: ["Tasks"],
  description:
    "For the configured SEO worker of a full-audit Task: Search Console clicks, impressions and average position before and after each done action on the audit's own pages, each page counted alone. `days` is the length of each window (7 to 91, default 28): choose a short window for a recent action and a long one for a slow page. State `too_early` means the after-window is not final yet, `not_measured` means no audit stored that page for those days, and `low_counts` means under 30 impressions in a window. The comparison does not rule out the season, other changes on the page or a Google update. It needs the same approval as a Search Console read and spends none.",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    query: z.object({ days: seoImpactDaysSchema }),
  },
  responses: {
    200: jsonSuccessResponse(
      seoTaskActionImpactSchema,
      "The done actions on the audit's pages with their before and after",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse(
      "Conflict. Branch on `kind`: seo_gsc_not_connected, seo_gsc_reconnect or seo_gsc_unavailable.",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      await readSeoTaskActionImpact(
        c.var.authContext,
        c.req.valid("param").id,
        c.req.valid("query").days,
      ),
    );
  });
}
