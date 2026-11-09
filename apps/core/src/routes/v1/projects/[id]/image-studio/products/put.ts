import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { requireStudioReferenceFiles } from "@/lib/image-studio/reference-files";
import { requireInteractiveUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { imageStudioProjectParamsSchema } from "@/schemas/project-image-studio.schema";
import { studioProductCatalogSchema } from "@/schemas/studio-product.schema";

const CATALOG_CHANGED =
  "This project or product catalog changed. Reopen the catalog before editing.";

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "put",
    path: "/{id}/image-studio/products",
    operationId: "replaceStudioProductCatalog",
    tags: ["Projects"],
    request: {
      params: imageStudioProjectParamsSchema,
      body: {
        required: true,
        content: { "application/json": { schema: studioProductCatalogSchema } },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        studioProductCatalogSchema,
        "Studio product catalog saved",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      409: jsonErrorResponse("Catalog revision conflict"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: Pick<OpenAPIHonoWithAuth, "openapi">): void {
  app.openapi(route, async (c) => {
    const { userId } = requireInteractiveUserAuthContext(c.var.authContext);
    const { workspaceId, organizationId } = requireWorkspaceContext(
      c.var.workspaceContext,
    );
    const { id: projectId } = c.req.valid("param");
    const { products, revision } = c.req.valid("json");
    const updated = await serializableTransaction(async (tx) => {
      await requireProjectAccess({ projectId, workspaceId, userId }, tx);
      const project = await tx.project.findUnique({
        where: { id: projectId, workspaceId, closingAt: null, closedAt: null },
        select: { id: true },
      });
      if (!project) return { count: 0 };

      const linkedPhotos = products.flatMap(({ photo }) =>
        photo ? [photo.id] : [],
      );
      if (linkedPhotos.length) {
        const stored = revision
          ? await tx.projectStudioProductCatalog.findUnique({
              where: { projectId, revision },
              select: { products: true, revision: true },
            })
          : null;
        if (revision && !stored) return { count: 0 };
        const existing = new Set(
          stored
            ? studioProductCatalogSchema
                .parse(stored)
                .products.map(({ photo }) => photo?.id)
            : [],
        );
        await requireStudioReferenceFiles(
          {
            workspaceId,
            actor: { kind: "interactive", organizationId, userId },
            resourceIds: [...new Set(linkedPhotos)].filter(
              (id) => !existing.has(id),
            ),
          },
          tx,
        );
      }

      if (revision === 0) {
        return tx.projectStudioProductCatalog.createMany({
          data: { projectId, products, revision: 1 },
          skipDuplicates: true,
        });
      }
      return tx.projectStudioProductCatalog.updateMany({
        where: { projectId, revision },
        data: { products, revision: { increment: 1 } },
      });
    }, CATALOG_CHANGED);
    if (!updated.count) throw conflict(CATALOG_CHANGED);
    return ok(c, { products, revision: revision + 1 });
  });
}
