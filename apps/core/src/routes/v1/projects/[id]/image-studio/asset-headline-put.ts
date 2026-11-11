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
  saveStudioAdHeadlineSchema,
  studioAdHeadlineSchema,
} from "@/schemas/project-image-studio.schema";
import { saveStudioAdHeadline } from "@/services/studio-ad-headline.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/image-studio/assets/{assetId}/headline",
    operationId: "saveStudioAdHeadline",
    tags: ["Projects"],
    request: {
      params: imageStudioAssetParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: saveStudioAdHeadlineSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(studioAdHeadlineSchema, "Saved export headline"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Image not found"),
      409: jsonErrorResponse("Headline save conflict"),
      422: jsonErrorResponse("Headline is unavailable in Brand Kit"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");
    const { text } = c.req.valid("json");
    const headline = await saveStudioAdHeadline({
      projectId,
      workspaceId,
      userId,
      assetId,
      text,
    });
    return ok(c, studioAdHeadlineSchema.parse(headline));
  });
}
