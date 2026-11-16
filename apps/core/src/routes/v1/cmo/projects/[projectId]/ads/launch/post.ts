import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  adsActions,
  launchConfig,
} from "@/routes/v1/cmo/projects/[projectId]/ads/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

const launchProjectRoute = createRoute({
  ...launchConfig,
  path: "/projects/{projectId}/ads/launch",
  operationId: "launchCmoSearchAdForProject",
  request: { ...launchConfig.request, params: cmoProjectParamsSchema },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(launchProjectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { entryId } = c.req.valid("json");
    return ok(c, await adsActions.launch({ userId, projectId }, entryId));
  });
}
