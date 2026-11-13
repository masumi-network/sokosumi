import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  imageStudioAssetParamsSchema,
  recordStudioAssetEventSchema,
} from "@/schemas/project-image-studio.schema";
import { recordStudioAssetLightboxView } from "@/services/image-studio-feedback.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/assets/{assetId}/events",
    operationId: "recordStudioAssetEvent",
    tags: ["Projects"],
    description:
      "Record a lightbox view. Other implicit signals are recorded by Core when their action succeeds.",
    request: {
      params: imageStudioAssetParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: recordStudioAssetEventSchema },
        },
      },
    },
    responses: {
      204: { description: "View acknowledged" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Image not found"),
      422: jsonErrorResponse("Invalid event"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");
    await recordStudioAssetLightboxView({
      userId,
      workspaceId,
      projectId,
      assetId,
    });
    return empty(c);
  });
}
