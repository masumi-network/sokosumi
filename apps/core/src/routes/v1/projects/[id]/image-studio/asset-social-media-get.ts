import { createRoute } from "@hono/zod-openapi";
import { socialPostMediaKindForMime } from "@sokosumi/utils";
import { head } from "@vercel/blob";

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
import { imageStudioAssetParamsSchema } from "@/schemas/project-image-studio.schema";
import { socialPostMediaRefSchema } from "@/schemas/social-post.schema";
import { ensureStudioAssetDriveFile } from "@/services/image-studio-drive.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio/assets/{assetId}/social-media",
    description:
      "A Drive file Social can attach for this studio image. Copies the image into Files the first time; later calls reuse that file.",
    tags: ["Projects"],
    request: {
      params: imageStudioAssetParamsSchema,
    },
    responses: {
      200: jsonSuccessResponse(
        socialPostMediaRefSchema,
        "Drive file ready to attach",
      ),
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

    const access = await requireProjectAccess({
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    });

    const file = await ensureStudioAssetDriveFile({
      projectId,
      assetId,
      workspaceId: access.workspaceId,
      organizationId: access.organizationId,
      userId: access.userId,
    });
    if (!file) throw notFound("Image not found");

    const kind = socialPostMediaKindForMime(file.mimeType);
    if (!kind) throw notFound("Image not found");

    let fileUrl: string;
    try {
      fileUrl = (await head(file.pathname)).url;
    } catch {
      throw serviceUnavailable("Could not attach this image");
    }

    return ok(
      c,
      socialPostMediaRefSchema.parse({
        pathname: file.pathname,
        fileUrl,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        kind,
      }),
    );
  });
}
