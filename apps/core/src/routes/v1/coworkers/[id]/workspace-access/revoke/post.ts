import { createRoute } from "@hono/zod-openapi";

import {
  forceRevokeCoworkerWorkspaceAccessByPair,
  resolveCoworkerAccessTargetWorkspaceId,
  toCoworkerWorkspaceAccessApiShape,
} from "@/helpers/coworker-workspace-access";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireUserAuthContext } from "@/middleware/auth";
import {
  coworkerWorkspaceAccessSchema,
  coworkerWorkspaceAccessWorkspaceIdBodySchema,
} from "@/schemas/coworker-workspace-access.schema";

import { paramsSchema } from "../../schema";

const route = createRoute({
  method: "post",
  path: "/{id}/workspace-access/revoke",
  operationId: "revokeCoworkerWorkspaceAccessAsPlatformAdmin",
  description:
    "Force-revoke GRANTED coworker workspace access (platform admin only). Undoes a pilot grant without requiring the workspace owner. Body: exactly one of workspaceId, userId, organizationId, email, or organizationSlug. Does not create missing workspaces.",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: coworkerWorkspaceAccessWorkspaceIdBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      coworkerWorkspaceAccessSchema,
      "Coworker workspace access revoked",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userAuth = requireUserAuthContext(c.var.authContext);
    if (!hasAdminRole(userAuth.role)) {
      throw forbidden("Platform admin access required");
    }

    const { id: coworkerId } = c.req.valid("param");
    const target = c.req.valid("json");

    // Resolve + lock + status flip share one transaction so FOR UPDATE holds.
    // Find-only resolve: never create workspaces on ops undo.
    const access = await prisma.$transaction(async (tx) => {
      const workspaceId = await resolveCoworkerAccessTargetWorkspaceId(
        target,
        { createIfMissing: false },
        tx,
      );
      return forceRevokeCoworkerWorkspaceAccessByPair(
        {
          coworkerId,
          workspaceId,
          resolvedById: userAuth.userId,
        },
        tx,
      );
    });

    return ok(
      c,
      coworkerWorkspaceAccessSchema.parse(
        toCoworkerWorkspaceAccessApiShape(access),
      ),
    );
  });
}
