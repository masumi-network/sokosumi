import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioAssetParamsSchema } from "@/schemas/project-image-studio.schema";
import { hideStudioAsset } from "@/services/image-studio-feedback.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/assets/{assetId}/hide",
    operationId: "hideStudioAsset",
    tags: ["Projects"],
    description:
      "Hide an asset from the workspace gallery while preserving its generation history.",
    request: { params: imageStudioAssetParamsSchema },
    responses: {
      204: { description: "Asset hidden" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Image not found"),
      422: jsonErrorResponse("Invalid asset"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");
    await hideStudioAsset({ userId, workspaceId, projectId, assetId });
    return empty(c);
  });
}
