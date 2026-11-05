import { createRoute } from "@hono/zod-openapi";

import { notFound, serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  imageStudioAssetParamsSchema,
  imageStudioCaptionSchema,
} from "@/schemas/project-image-studio.schema";
import { writeStudioAssetCaption } from "@/services/image-studio-caption.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/assets/{assetId}/caption",
    description:
      "A social caption for this studio image, written from its prompt the way Soko Bot writes.",
    tags: ["Projects"],
    request: {
      params: imageStudioAssetParamsSchema,
    },
    responses: {
      200: jsonSuccessResponse(imageStudioCaptionSchema, "Caption written"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");

    await requireProjectAccess({
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    });

    let result: Awaited<ReturnType<typeof writeStudioAssetCaption>>;
    try {
      result = await writeStudioAssetCaption({ projectId, assetId });
    } catch {
      throw serviceUnavailable("Could not write a caption");
    }
    if (result.isErr()) {
      if (result.error === "missing") throw notFound("Image not found");
      throw serviceUnavailable("Could not write a caption");
    }

    return ok(c, imageStudioCaptionSchema.parse({ text: result.value }));
  });
}
