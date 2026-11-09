import { createRoute, z } from "@hono/zod-openapi";
import { MAX_STUDIO_BATCH_IMAGES } from "@sokosumi/utils";

import { notFound, payloadTooLarge } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  assetContentPath,
  imageStudioAssetSchema,
  imageStudioProjectParamsSchema,
} from "@/schemas/project-image-studio.schema";
import { listAssets } from "@/services/image-studio-assets.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio/batches/{batchId}/assets",
    operationId: "listStudioBatchAssets",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema.extend({ batchId: z.uuid() }),
    },
    responses: {
      200: jsonSuccessResponse(
        z.array(imageStudioAssetSchema).max(MAX_STUDIO_BATCH_IMAGES),
        "Finished ads in a Studio batch",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Batch has no finished ads"),
      413: jsonErrorResponse("Batch exceeds the image limit"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">) {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, batchId } = c.req.valid("param");
    const { assets, nextCursor } = await listAssets({
      projectId,
      userId,
      workspaceId,
      batchId,
      limit: MAX_STUDIO_BATCH_IMAGES,
    });
    if (nextCursor) throw payloadTooLarge("Batch exceeds the image limit");
    if (!assets.length) throw notFound("Batch has no finished ads");
    return ok(
      c,
      assets.map((asset) =>
        imageStudioAssetSchema.parse({
          ...asset,
          contentPath: assetContentPath(projectId, asset.id),
        }),
      ),
    );
  });
}
