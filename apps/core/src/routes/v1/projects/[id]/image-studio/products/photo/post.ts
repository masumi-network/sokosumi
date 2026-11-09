import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";
import {
  studioProductPhotoRequestSchema,
  studioProductPhotoSchema,
} from "@/schemas/studio-product.schema";
import { copyRemoteStudioProductPhoto } from "@/services/studio-product-catalog.service";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "post",
    path: "/{id}/image-studio/products/photo",
    operationId: "attachStudioProductPhoto",
    description:
      "Copy a reviewed product photo to this workspace for ad generation.",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: {
          "application/json": { schema: studioProductPhotoRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        studioProductPhotoSchema,
        "Product photo attached",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
      503: jsonErrorResponse("Service Unavailable"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    const { name, imageUrl } = c.req.valid("json");
    const { organizationId } = await requireProjectAccess({
      projectId,
      workspaceId,
      userId,
    });
    // A changed source image gets its own file. A job retry still reads the
    // photo it used originally, even when the store replaces its image.
    const photo = await copyRemoteStudioProductPhoto({
      imageUrl,
      name,
      workspaceId,
      organizationId,
      userId,
    });
    return ok(c, photo);
  });
}
