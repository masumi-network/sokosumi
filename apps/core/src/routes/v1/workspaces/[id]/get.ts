import { createRoute, z } from "@hono/zod-openapi";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { workspaceOrganizationSchema } from "@/schemas/workspace.schema";

const paramsSchema = z.object({
  id: z
    .string()
    .uuid()
    .openapi({
      param: { name: "id", in: "path" },
      example: "11111111-1111-7111-8111-111111111111",
    }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Resolve a workspace id to its organization id",
  tags: ["Workspaces"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      workspaceOrganizationSchema,
      "Workspace organization mapping",
      {
        data: {
          organizationId: "org_123",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = await requireAuthorizedUserContext(authContext);
    const { id } = c.req.valid("param");

    const workspace = await prisma.workspace.findUnique({
      where: { id },
      select: {
        userId: true,
        organizationId: true,
      },
    });

    if (!workspace) {
      throw notFound("Workspace not found");
    }

    if (workspace.organizationId) {
      await resolveMemberOrganizationById({
        id: workspace.organizationId,
        userId: userContext.userId,
        tx: prisma,
      });
    } else if (workspace.userId !== userContext.userId) {
      throw forbidden("You do not have access to this workspace");
    }

    return ok(
      c,
      workspaceOrganizationSchema.parse({
        organizationId: workspace.organizationId,
      }),
    );
  });
}
