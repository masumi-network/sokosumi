import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { mapBrandBrainForApi } from "@/routes/v1/projects/[id]/brand-brain/context";
import { brandBrainSchema } from "@/schemas/brand-brain.schema";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { confirmBrandBrain } from "@/services/brand-brain.service";
import { requireCuso } from "@/services/cmo-cuso.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/brand-brain/confirm",
  operationId: "confirmCmoBrandBrainForProject",
  tags: ["CMO"],
  description:
    "A member confirms the Brand Brain of the Cuso's Project, as `POST /v1/projects/{id}/brand-brain/confirm` does. Records who and when, replacing an earlier confirmation.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(brandBrainSchema, "Brand Brain confirmed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
    409: jsonErrorResponse("The Brand Brain is still being built"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = await requireCuso({
      userId,
      projectId: c.req.valid("param").projectId,
    }).catch(rethrow);
    return ok(
      c,
      mapBrandBrainForApi(await confirmBrandBrain(projectId, userId)),
    );
  });
}
