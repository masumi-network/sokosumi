import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { config, revert } from "@/routes/v1/cmo/updates/[id]/revert/post";
import {
  cmoProjectParamsSchema,
  cmoReportIdParamsSchema,
} from "@/schemas/cmo.schema";

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/updates/{id}/revert",
  operationId: "revertCmoUpdateForProject",
  request: {
    ...config.request,
    params: cmoProjectParamsSchema.extend(cmoReportIdParamsSchema.shape),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    return ok(c, await revert({ userId, projectId }, id));
  });
}
