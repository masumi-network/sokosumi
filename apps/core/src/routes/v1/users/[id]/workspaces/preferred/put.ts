import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { getUserWorkspace } from "@/helpers/user-workspaces";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  setPreferredUserWorkspaceSchema,
  userWorkspaceSchema,
} from "@/schemas/user-workspace.schema";
import { setPreferredOrganizationId } from "@/services/preferred-organization.service";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "put",
  path: "/workspaces/preferred",
  description:
    "Set the workspace a new session opens for the user (path `me` for the session user, or a user id the caller may access). A personal workspace must be the user's own; an organization workspace requires membership (403). An unknown workspace is 404. See ADR 0051.",
  tags: ["Users"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: setPreferredUserWorkspaceSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(userWorkspaceSchema, "The preferred workspace", {
      data: {
        id: "11111111-1111-7111-8111-111111111111",
        kind: "organization",
        name: "Acme",
        organizationId: "org_123",
        slug: "acme-x1y2z3",
        logo: null,
        websiteUrl: "https://acme.com",
        preferred: true,
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - The user is not a member of the organization",
    ),
    404: jsonErrorResponse("Not Found - Workspace not found"),
    422: jsonErrorResponse("Unprocessable Entity - Invalid body"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const { workspaceId } = c.req.valid("json");

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { userId: true, organizationId: true },
    });

    if (workspace?.organizationId) {
      await setPreferredOrganizationId(
        resolvedUserId,
        workspace.organizationId,
      );
    } else if (workspace?.userId === resolvedUserId) {
      await setPreferredOrganizationId(resolvedUserId, null);
    } else {
      throw notFound("Workspace not found");
    }

    return ok(
      c,
      userWorkspaceSchema.parse(
        await getUserWorkspace(resolvedUserId, { id: workspaceId }),
      ),
    );
  });
}
