import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioAssetParamsSchema } from "@/schemas/project-image-studio.schema";
import { openAssetStream } from "@/services/image-studio-assets.service";

/**
 * The only way to read a stored image.
 *
 * The object itself is private, so there is no URL that works without this
 * route, and this route re-checks the caller's current access to the Project
 * on every request. A link shared out of the product stops working for anyone
 * who is not still a member.
 */
const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio/assets/{assetId}/content",
    description:
      "Stream one image version's bytes. Authorized per request; the stored object has no publicly readable URL.",
    tags: ["Projects"],
    request: {
      params: imageStudioAssetParamsSchema,
    },
    responses: {
      200: {
        description: "Image bytes",
        content: {
          "image/*": { schema: { type: "string", format: "binary" } },
        },
      },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");

    const result = await openAssetStream({
      assetId,
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    });

    return c.body(result.stream, 200, {
      "content-type": result.contentType,
      "content-length": String(result.size),
      // The bytes never change for a given asset, but the *permission* to read
      // them can be revoked, so only the browser that authenticated may keep a
      // copy and a shared cache must not.
      "cache-control": "private, max-age=300",
      etag: `"${result.checksum}"`,
      "content-disposition": `inline; filename="${assetId}"`,
    });
  });
}
