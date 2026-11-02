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
import { confirmBrandBrain } from "@/services/brand-brain.service";

import { requireWorkspaceProject } from "../../access";
import { mapBrandBrainForApi } from "../context";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/brand-brain/confirm",
    operationId: "confirmProjectBrandBrain",
    tags: ["Projects"],
    description:
      "A member confirms the Project's Brand Brain, so bots know a person checked it. Records who and when, replacing an earlier confirmation.",
    request: { params: brandBrainProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(brandBrainSchema, "Brand Brain confirmed"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("The Brand Brain is still being built"),
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
    return ok(
      c,
      mapBrandBrainForApi(await confirmBrandBrain(projectId, userId)),
    );
  });
}
