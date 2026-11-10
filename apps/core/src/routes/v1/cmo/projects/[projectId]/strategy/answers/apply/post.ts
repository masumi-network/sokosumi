import { createRoute } from "@hono/zod-openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { apply, config } from "@/routes/v1/cmo/strategy/answers/apply/post";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/strategy/answers/apply",
  operationId: "applyCmoPlanAnswersForProject",
  request: { params: cmoProjectParamsSchema },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return created(c, await apply({ userId, projectId }));
  });
}
