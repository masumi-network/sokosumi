import { createRoute } from "@hono/zod-openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { config, request } from "@/routes/v1/cmo/strategy/post";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/strategy",
  operationId: "requestCmoStrategyForProject",
  request: { ...config.request, params: cmoProjectParamsSchema },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { note } = c.req.valid("json");
    return created(c, await request({ userId, projectId }, note));
  });
}
