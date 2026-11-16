import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  adsActions,
  finalizeConfig,
} from "@/routes/v1/cmo/projects/[projectId]/ads/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

const finalizeProjectRoute = createRoute({
  ...finalizeConfig,
  path: "/projects/{projectId}/ads/finalize",
  operationId: "finalizeCmoAdsForProject",
  request: { ...finalizeConfig.request, params: cmoProjectParamsSchema },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(finalizeProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(
      c,
      await adsActions.finalize({ userId, projectId }, c.req.valid("json")),
    );
  });
}
