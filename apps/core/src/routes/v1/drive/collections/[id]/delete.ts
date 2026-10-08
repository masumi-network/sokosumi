import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse } from "@/helpers/openapi";
import { empty } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({ param: { name: "id", in: "path" } }),
});

const querySchema = z.object({
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}",
    description: [
      "Delete one of your own collections.",
      "This removes a saved view, never a file.",
    ].join("\n"),
    tags: ["Drive"],
    request: { params: paramsSchema, query: querySchema },
    responses: {
      204: { description: "Collection deleted" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const query = c.req.valid("query");

    const context = await resolveFileRequestContext({
      authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });

    const deleted = await prisma.fileCollection.deleteMany({
      where: {
        id,
        workspaceId: context.workspaceId,
        ownerUserId: context.actor.userId,
      },
    });
    if (deleted.count === 0) throw notFound("Collection not found");

    return empty(c);
  });
}
