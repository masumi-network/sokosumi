import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { assetContentPath } from "@/schemas/project-image-studio.schema";
import {
  studioCompareParamsSchema,
  studioCompareStateSchema,
} from "@/schemas/studio-compare.schema";
import { getStudioComparePair } from "@/services/studio-compare.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio/batches/{batchId}/compare",
    operationId: "getStudioComparePair",
    description:
      "Next same-brief, same-placement image pair not yet compared by this user. Different models come first; pair is null when done.",
    tags: ["Projects"],
    request: { params: studioCompareParamsSchema },
    responses: {
      200: jsonSuccessResponse(studioCompareStateSchema, "Next comparison"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Project not found"),
      413: jsonErrorResponse("Batch exceeds the image limit"),
      422: jsonErrorResponse("Invalid parameters"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, batchId } = c.req.valid("param");
    const pair = await getStudioComparePair({
      projectId,
      workspaceId,
      userId,
      batchId,
    });
    return ok(
      c,
      studioCompareStateSchema.parse({
        pair: pair
          ? {
              a: {
                ...pair.a,
                contentPath: assetContentPath(projectId, pair.a.id),
              },
              b: {
                ...pair.b,
                contentPath: assetContentPath(projectId, pair.b.id),
              },
            }
          : null,
      }),
    );
  });
}
