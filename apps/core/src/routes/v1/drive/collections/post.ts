import { createRoute, z } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";

import { conflict } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import {
  createFileCollectionRequestSchema,
  fileCollectionSchema,
} from "@/schemas/file-resource.schema";

const bodySchema = createFileCollectionRequestSchema.extend({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/",
    description: [
      "Save the current filters and sort as a collection.",
      "Private by default. Sharing shares the definition only: every reader",
      "still sees their own authorized results.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
    },
    responses: {
      201: jsonSuccessResponse(fileCollectionSchema, "Collection created"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      409: jsonErrorResponse("Conflict"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const context = await resolveFileRequestContext({
      authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });

    const existing = await prisma.fileCollection.findUnique({
      where: {
        workspaceId_ownerUserId_name: {
          workspaceId: context.workspaceId,
          ownerUserId: context.actor.userId,
          name: body.name,
        },
      },
      select: { id: true },
    });
    if (existing)
      throw conflict("You already have a collection with that name");

    const collection = await prisma.fileCollection.create({
      data: {
        workspaceId: context.workspaceId,
        ownerUserId: context.actor.userId,
        name: body.name,
        definition: body.definition as Prisma.InputJsonValue,
        sortBy: body.sortBy ?? null,
        sortOrder: body.sortOrder ?? null,
        isShared: body.isShared ?? false,
      },
    });

    return created(
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
