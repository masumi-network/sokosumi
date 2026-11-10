import { createRoute, z } from "@hono/zod-openapi";
import { jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { config, startOver } from "@/routes/v1/cmo/start-over/post";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { findCusoForUser } from "@/services/cmo-cuso.service";

/** The same, for the Cuso of the Project the path names. */
const projectRoute = createRoute({
  ...config,
  path: "/projects/{projectId}/start-over",
  operationId: "startCmoOverForProject",
  request: { params: cmoProjectParamsSchema },
  responses: {
    ...config.responses,
    200: jsonSuccessResponse(
      z.object({
        startedOver: z.literal(true),
        projectId: cmoProjectParamsSchema.shape.projectId.nullable(),
      }),
      "Cuso is archived and the next Project is selected",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(projectRoute, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const result = await startOver({ userId, projectId });
    const nextCuso = await findCusoForUser(userId);
    return ok(c, { ...result, projectId: nextCuso?.projectId ?? null });
  });
}
