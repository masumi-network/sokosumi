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
  imageStudioAssetParamsSchema,
  setStudioAssetFeedbackSchema,
  studioAssetRatingSchema,
} from "@/schemas/project-image-studio.schema";
import { setStudioAssetFeedback } from "@/services/image-studio-feedback.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/image-studio/assets/{assetId}/feedback",
    operationId: "setStudioAssetFeedback",
    tags: ["Projects"],
    description:
      "Set this person's thumb and optional reasons. A null thumb clears their feedback.",
    request: {
      params: imageStudioAssetParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: setStudioAssetFeedbackSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        studioAssetRatingSchema,
        "Workspace asset rating",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Image not found"),
      422: jsonErrorResponse("Invalid feedback"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");
    const rating = await setStudioAssetFeedback({
      ...c.req.valid("json"),
      userId,
      workspaceId,
      projectId,
      assetId,
    });
    return ok(c, studioAssetRatingSchema.parse(rating));
  });
}
