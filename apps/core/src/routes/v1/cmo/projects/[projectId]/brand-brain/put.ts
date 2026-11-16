import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { mapBrandBrainForApi } from "@/routes/v1/projects/[id]/brand-brain/context";
import {
  brandBrainRequestSchema,
  brandBrainSchema,
} from "@/schemas/brand-brain.schema";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { getBrandBrain, saveBrandBrain } from "@/services/brand-brain.service";
import { requireCuso } from "@/services/cmo-cuso.service";

const route = createRoute({
  method: "put",
  path: "/projects/{projectId}/brand-brain",
  operationId: "updateCmoBrandBrainForProject",
  tags: ["CMO"],
  description:
    "Saves the Brand Brain of the Cuso's Project, as `PUT /v1/projects/{id}/brand-brain` does. Each profile section sent replaces its own; the members' answers are kept and the confirmation stays as it was.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: brandBrainRequestSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(brandBrainSchema, "Brand Brain saved"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = await requireCuso({
      userId,
      projectId: c.req.valid("param").projectId,
    }).catch(rethrow);
    await saveBrandBrain(projectId, c.req.valid("json"));
    return ok(c, mapBrandBrainForApi(await getBrandBrain(projectId)));
  });
}
