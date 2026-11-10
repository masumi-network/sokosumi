import { createRoute } from "@hono/zod-openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  config,
  connect,
} from "@/routes/v1/cmo/measurement/[provider]/connect/post";
import {
  cmoMeasurementSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/measurement/{provider}/connect",
  operationId: "connectCmoMeasurementForProject",
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
    const { returnUrl } = c.req.valid("json");
    return ok(c, await connect({ userId, projectId }, provider, returnUrl));
  });
}
