import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  adsActions,
  statusConfig,
} from "@/routes/v1/cmo/projects/[projectId]/ads/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

const statusProjectRoute = createRoute({
  ...statusConfig,
  path: "/projects/{projectId}/ads/campaigns/status",
  operationId: "setCmoAdCampaignStatusForProject",
  request: { ...statusConfig.request, params: cmoProjectParamsSchema },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(statusProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(
      c,
      await adsActions.status({ userId, projectId }, c.req.valid("json")),
    );
  });
}
