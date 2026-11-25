import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import {
  approveCoworkerWorkspaceAccess,
  toCoworkerWorkspaceAccessApiShape,
} from "@/helpers/coworker-workspace-access";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import { organizationSettingsWebPath } from "@/helpers/workspace-approval-web-path";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requirePersonApproval } from "@/middleware/auth";
import { coworkerWorkspaceAccessSchema } from "@/schemas/coworker-workspace-access.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
  }),
  accessId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "accessId", in: "path" },
      description: "Coworker workspace access ID",
    }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/coworker-access/{accessId}/approve",
  description:
    "Approve a PENDING coworker workspace access for an organization workspace. Owner/admin only.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      coworkerWorkspaceAccessSchema,
      "Coworker workspace access approved",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, accessId } = c.req.valid("param");
    // A person approves in Sokosumi; agents may only ask, deny or revoke (ADR 0077).
    const userContext = requirePersonApproval(
      c.var.authContext,
      await organizationSettingsWebPath(id),
    );

    await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const workspace = await prisma.workspace.findUnique({
      where: { organizationId: id },
      select: { id: true },
    });

    if (!workspace) {
      throw badRequest("Organization workspace not found");
    }

    const access = await prisma.$transaction(async (tx) =>
      approveCoworkerWorkspaceAccess(
        {
          accessId,
          workspaceId: workspace.id,
          resolvedById: userContext.userId,
        },
        tx,
      ),
    );

    return ok(
      c,
      coworkerWorkspaceAccessSchema.parse(
        toCoworkerWorkspaceAccessApiShape(access),
      ),
    );
  });
}
