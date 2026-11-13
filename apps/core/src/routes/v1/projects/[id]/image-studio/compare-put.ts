import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  saveStudioPairwisePickSchema,
  studioCompareParamsSchema,
  studioPairwisePickSchema,
} from "@/schemas/studio-compare.schema";
import { saveStudioPairwisePick } from "@/services/studio-compare.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/image-studio/batches/{batchId}/compare",
    operationId: "saveStudioPairwisePick",
    description:
      "Save this user's comparison of two same-brief, same-placement batch siblings. Stores canonical asset order and replaces a previous pick for this pair.",
    tags: ["Projects"],
    request: {
      params: studioCompareParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: saveStudioPairwisePickSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(studioPairwisePickSchema, "Saved comparison"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Project not found"),
      413: jsonErrorResponse("Batch exceeds the image limit"),
      422: jsonErrorResponse("Choose matching batch siblings"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, batchId } = c.req.valid("param");
    const pick = await saveStudioPairwisePick({
      projectId,
      workspaceId,
      userId,
      batchId,
      ...c.req.valid("json"),
    });
    return ok(c, studioPairwisePickSchema.parse(pick));
  });
}
