import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { conflict, notFound } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  fileCollectionSchema,
  updateFileCollectionRequestSchema,
} from "@/schemas/file-resource.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

const bodySchema = updateFileCollectionRequestSchema.extend({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: [
    "Rename a collection, or re-save it over the current filters and sort.",
    "Only the owner may change one: a shared collection's definition belongs",
    "to whoever saved it, and every reader still sees their own authorized",
    "results from it.",
  ].join("\n"),
  tags: ["Drive"],
  request: {
    params: paramsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: bodySchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(fileCollectionSchema, "Collection updated"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });

    // Scoped by workspace *and* owner: someone else's collection answers
    // the same way a missing one does, so the response never confirms that
    // a collection exists to a reader who may not change it.
    const existing = await prisma.fileCollection.findFirst({
      where: {
        id,
        workspaceId: context.workspaceId,
        ownerUserId: context.actor.userId,
      },
      select: { id: true },
    });
    if (!existing) throw notFound("Collection not found");

    if (body.name !== undefined) {
      const clash = await prisma.fileCollection.findFirst({
        where: {
          workspaceId: context.workspaceId,
          ownerUserId: context.actor.userId,
          name: body.name,
          id: { not: id },
        },
        select: { id: true },
      });
      if (clash) throw conflict("You already have a collection with that name");
    }

    const collection = await prisma.fileCollection.update({
      where: { id },
      data: {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.definition === undefined
          ? {}
          : {
              definition: body.definition as Prisma.InputJsonValue,
              // A re-saved definition is a new version, so a reader holding
              // the old one can tell it moved.
              definitionVersion: { increment: 1 },
            }),
        ...(body.sortBy === undefined ? {} : { sortBy: body.sortBy ?? null }),
        ...(body.sortOrder === undefined
          ? {}
          : { sortOrder: body.sortOrder ?? null }),
        ...(body.isShared === undefined ? {} : { isShared: body.isShared }),
      },
    });

    return ok(
      c,
      fileCollectionSchema.parse({
        id: collection.id,
        name: collection.name,
        definition: collection.definition as Record<string, unknown>,
        sortBy: collection.sortBy,
        sortOrder: collection.sortOrder,
        isShared: collection.isShared,
        definitionVersion: collection.definitionVersion,
        isOwner: true,
      }),
    );
  });
}
