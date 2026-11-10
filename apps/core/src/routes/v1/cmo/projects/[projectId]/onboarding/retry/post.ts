import { createRoute } from "@hono/zod-openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { config, retry } from "@/routes/v1/cmo/onboarding/retry/post";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/onboarding/retry",
  operationId: "retryCmoOnboardingForProject",
  request: { params: cmoProjectParamsSchema },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return created(c, await retry({ userId, projectId }));
  });
}
