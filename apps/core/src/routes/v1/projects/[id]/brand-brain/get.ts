import { createRoute } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  brandBrainProjectParamsSchema,
  brandBrainSchema,
} from "@/schemas/brand-brain.schema";
import { getBrandBrain } from "@/services/brand-brain.service";

import { requireWorkspaceProject } from "../access";
import { mapBrandBrainForApi } from "./context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/brand-brain",
    operationId: "getProjectBrandBrain",
    tags: ["Projects"],
    description:
      "The Project's Brand Brain: what it knows about the business it works for, when it was last saved and who confirmed it.",
    request: { params: brandBrainProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(brandBrainSchema, "Brand Brain"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { userId } = await requireAuthorizedUserContext(c.var.authContext);
    const { projectId } = await requireWorkspaceProject(
      c,
      c.req.valid("param").id,
      userId,
    );
    return ok(c, mapBrandBrainForApi(await getBrandBrain(projectId)));
  });
}
