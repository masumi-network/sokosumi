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
  assetContentPath,
  imageStudioAssetParamsSchema,
  imageStudioAssetSchema,
  reviewImageAssetRequestSchema,
} from "@/schemas/project-image-studio.schema";
import {
  clearAssetReview,
  reviewAsset,
} from "@/services/image-studio-assets.service";

const postRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/assets/{assetId}/review",
    description:
      "Approve or reject one image version. The decision belongs to that version alone; refinements start undecided.",
    tags: ["Projects"],
    request: {
      params: imageStudioAssetParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: reviewImageAssetRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(imageStudioAssetSchema, "Reviewed version"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

const deleteRoute = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "delete",
    path: "/{id}/image-studio/assets/{assetId}/review",
    description: "Return one image version to undecided.",
    tags: ["Projects"],
    request: { params: imageStudioAssetParamsSchema },
    responses: {
      200: jsonSuccessResponse(imageStudioAssetSchema, "Undecided version"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(postRoute, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");
    const input = c.req.valid("json");

    const asset = await reviewAsset({
      assetId,
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
      decision: input.decision,
      feedback: input.feedback,
    });
    return ok(
      c,
      imageStudioAssetSchema.parse({
        ...asset,
        contentPath: assetContentPath(projectId, asset.id),
      }),
    );
  });

  app.openapi(deleteRoute, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");

    const asset = await clearAssetReview({
      assetId,
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    });
    return ok(
      c,
      imageStudioAssetSchema.parse({
        ...asset,
        contentPath: assetContentPath(projectId, asset.id),
      }),
    );
  });
}
