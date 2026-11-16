import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  adsActions,
  campaignsConfig,
} from "@/routes/v1/cmo/projects/[projectId]/ads/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

const campaignsProjectRoute = createRoute({
  ...campaignsConfig,
  path: "/projects/{projectId}/ads/campaigns",
  operationId: "listCmoAdCampaignsForProject",
  request: { ...campaignsConfig.request, params: cmoProjectParamsSchema },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(campaignsProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { range } = c.req.valid("query");
    return ok(c, await adsActions.campaigns({ userId, projectId }, range));
  });
}
