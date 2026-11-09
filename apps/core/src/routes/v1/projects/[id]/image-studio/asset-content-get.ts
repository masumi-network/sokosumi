import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse } from "@/helpers/openapi";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  imageStudioAssetContentQuerySchema,
  imageStudioAssetParamsSchema,
} from "@/schemas/project-image-studio.schema";
import { openAssetStream } from "@/services/image-studio-assets.service";
import { renderBrandedStudioAsset } from "@/services/image-studio-brand-export.service";

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
      "Stream one image or video version's bytes, honouring a Range header. Authorized per request; the stored object has no publicly readable URL.",
    tags: ["Projects"],
    request: {
      params: imageStudioAssetParamsSchema,
      query: imageStudioAssetContentQuerySchema,
    },
    responses: {
      200: {
        description: "Image or video bytes",
        content: {
          "image/*": { schema: { type: "string", format: "binary" } },
          "video/*": { schema: { type: "string", format: "binary" } },
        },
      },
      206: {
        description: "The requested byte range of a video",
        content: {
          "video/*": { schema: { type: "string", format: "binary" } },
        },
      },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse(
        "The selected image or brand logo cannot be rendered",
      ),
      // Distinct from 404: the version exists, but the private store it lives
      // in is not configured, so the bytes cannot be fetched at all. A caller
      // should retry later rather than treat the version as gone.
      503: jsonErrorResponse("Service Unavailable - image storage unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const userContext = requireInteractiveUserAuthContext(c.var.authContext);
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId, assetId } = c.req.valid("param");

    const scope = {
      assetId,
      projectId,
      workspaceId: workspaceContext.workspaceId,
      userId: userContext.userId,
    };
    const { logo } = c.req.valid("query");
    if (logo) {
      const bytes = await renderBrandedStudioAsset(scope, logo);
      return c.body(bytes, 200, {
        "cache-control": "private, no-store",
        "content-type": "image/png",
        "content-length": String(bytes.byteLength),
        "content-disposition": `inline; filename="${assetId}-branded.png"`,
      });
    }

    const result = await openAssetStream({
      ...scope,
      range: c.req.header("range"),
    });

    return c.body(result.stream, result.contentRange ? 206 : 200, {
      "content-type": result.contentType,
      "content-length": String(result.size),
      "accept-ranges": "bytes",
      ...(result.contentRange ? { "content-range": result.contentRange } : {}),
      // The bytes never change for a given asset, but the *permission* to
      // read them can be revoked at any moment. `no-cache` keeps the browser's
      // copy while forcing it back through this route — which re-checks access
      // — before reusing it, so a removed member's cached image stops being
      // served. The etag below is what makes that revalidation cheap (304).
      "cache-control": "private, no-cache",
      etag: `"${result.checksum}"`,
      "content-disposition": `inline; filename="${assetId}"`,
    });
  });
}
