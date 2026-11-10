import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  config,
  finalize,
} from "@/routes/v1/cmo/measurement/[provider]/finalize/post";
import {
  cmoMeasurementSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/measurement/{provider}/finalize",
  operationId: "finalizeCmoMeasurementForProject",
  request: {
    ...config.request,
    params: cmoProjectParamsSchema.extend({
      provider: cmoMeasurementSchema.shape.provider,
    }),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, provider } = c.req.valid("param");
    return ok(c, await finalize({ userId, projectId }, provider));
  });
}
