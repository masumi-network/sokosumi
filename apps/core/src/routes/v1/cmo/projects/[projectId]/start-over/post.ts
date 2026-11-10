import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { findCusoForUser } from "@/services/cmo-cuso.service";
import { startCmoOver } from "@/services/cmo-hiring.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/start-over",
  operationId: "startCmoOverForProject",
  tags: ["CMO"],
  description:
    "Archives the Cuso of the Project the path names and cancels his unsent posts, so the caller can hire Cuso for another website.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(
      z.object({
        startedOver: z.literal(true),
        projectId: cmoProjectParamsSchema.shape.projectId.nullable(),
      }),
      "Cuso is archived and the next Project is selected",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Only an organization owner or admin can"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    await startCmoOver({ userId, projectId }).catch(rethrow);
    // The person's next default Cuso, which CMO opens from here.
    const nextCuso = await findCusoForUser(userId);
    return ok(c, {
      startedOver: true as const,
      projectId: nextCuso?.projectId ?? null,
    });
  });
}
