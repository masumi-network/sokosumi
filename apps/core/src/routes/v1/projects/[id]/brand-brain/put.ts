import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  brandBrainProjectParamsSchema,
  brandBrainRequestSchema,
  brandBrainSchema,
  mapBrandBrainForApi,
} from "@/schemas/brand-brain.schema";
import { getBrandBrain, saveBrandBrain } from "@/services/brand-brain.service";

import { brandBrainScope } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/{id}/brand-brain",
    operationId: "updateProjectBrandBrain",
    tags: ["Projects"],
    description:
      "Saves the Project's Brand Brain. Each profile section sent replaces its own; the members' answers to its questions are kept. Editing leaves the confirmation as it was.",
    request: {
      params: brandBrainProjectParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: brandBrainRequestSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(brandBrainSchema, "Brand Brain saved"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { projectId } = await brandBrainScope(c, c.req.valid("param").id);
    await saveBrandBrain(projectId, c.req.valid("json"));
    return ok(c, mapBrandBrainForApi(await getBrandBrain(projectId)));
  });
}
