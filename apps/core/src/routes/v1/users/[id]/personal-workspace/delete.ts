import { createRoute, z } from "@hono/zod-openapi";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { isPrismaForeignKeyViolation } from "@/helpers/prisma";
import { ok } from "@/helpers/response";
import { isLastWorkspace } from "@/helpers/workspace-access";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { personalWorkspaceDeletedSchema } from "@/schemas/personal-workspace.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "delete",
  path: "/personal-workspace",
  description:
    "Delete the user's personal workspace (path `me` for the session user, or a user id the caller may access). Refused when it is the user's last workspace. Organization membership must remain.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      personalWorkspaceDeletedSchema,
      "Personal workspace deleted",
      {
        data: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - Personal workspace is missing"),
    409: jsonErrorResponse(
      "Conflict - Last workspace, or dependents prevent delete",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await prisma.$transaction(async (tx) => {
      const existing = await tx.workspace.findUnique({
        where: { userId: resolvedUserId },
      });

      if (!existing) {
        throw notFound("Personal workspace is missing", {
          kind: CORE_API_ERROR_KINDS.PERSONAL_WORKSPACE_MISSING,
        });
      }

      if (await isLastWorkspace(resolvedUserId, { type: "personal" }, tx)) {
        throw conflict("Cannot delete the user's last workspace", {
          kind: CORE_API_ERROR_KINDS.LAST_WORKSPACE,
        });
      }

      const user = await tx.user.findUnique({
        where: { id: resolvedUserId },
        select: { preferredOrganizationId: true },
      });
      if (user?.preferredOrganizationId == null) {
        const remainingMembership = await tx.member.findFirst({
          where: { userId: resolvedUserId },
          select: { organizationId: true },
        });
        if (remainingMembership) {
          await tx.user.update({
            where: { id: resolvedUserId },
            data: {
              preferredOrganizationId: remainingMembership.organizationId,
            },
          });
        }
      }

      try {
        await tx.workspace.delete({
          where: { id: existing.id },
        });
      } catch (error) {
        if (isPrismaForeignKeyViolation(error)) {
          throw conflict(
            "Cannot delete a personal workspace that still has jobs or tasks",
            {
              kind: CORE_API_ERROR_KINDS.WORKSPACE_HAS_DEPENDENTS,
            },
          );
        }
        throw error;
      }

      return existing;
    });

    return ok(
      c,
      personalWorkspaceDeletedSchema.parse({ workspaceId: workspace.id }),
    );
  });
}
