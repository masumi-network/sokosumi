import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { fileCollectionSchema } from "@/schemas/file-resource.schema";

const querySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: [
      "Saved views: the reader's own collections plus any shared in this workspace.",
      "A collection is a filter definition, never a stored result set — each",
      "reader sees their own authorized subset and no count is cached.",
    ].join("\n"),
    tags: ["Drive"],
    request: { query: querySchema },
    responses: {
      200: jsonSuccessResponse(z.array(fileCollectionSchema), "Collections"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const query = c.req.valid("query");

    const context = await resolveFileRequestContext({
      authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });

    const collections = await prisma.fileCollection.findMany({
      where: {
        workspaceId: context.workspaceId,
        OR: [{ ownerUserId: context.actor.userId }, { isShared: true }],
      },
      orderBy: { name: "asc" },
    });

    return ok(
      c,
      z.array(fileCollectionSchema).parse(
        collections.map((collection) => ({
          id: collection.id,
          name: collection.name,
          definition: collection.definition as Record<string, unknown>,
          sortBy: collection.sortBy,
          sortOrder: collection.sortOrder,
          isShared: collection.isShared,
          definitionVersion: collection.definitionVersion,
          isOwner: collection.ownerUserId === context.actor.userId,
        })),
      ),
    );
  });
}
