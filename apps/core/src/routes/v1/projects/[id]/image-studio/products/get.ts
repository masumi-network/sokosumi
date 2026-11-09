import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";
import { studioProductCatalogSchema } from "@/schemas/studio-product.schema";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/image-studio/products",
    operationId: "getStudioProductCatalog",
    tags: ["Projects"],
    request: { params: imageStudioProjectParamsSchema },
    responses: {
      200: jsonSuccessResponse(
        studioProductCatalogSchema,
        "Studio product catalog",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId } = requireWorkspaceContext(c.var.workspaceContext);
    const { id: projectId } = c.req.valid("param");
    await requireProjectAccess({ projectId, workspaceId, userId });
    const catalog = await prisma.projectStudioProductCatalog.findUnique({
      where: { projectId },
      select: { products: true, revision: true },
    });
    return ok(
      c,
      studioProductCatalogSchema.parse(
        catalog ?? { products: [], revision: 0 },
      ),
    );
  });
}
