import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import {
  listCoworkerAccessForWorkspace,
  toCoworkerWorkspaceAccessApiShape,
} from "@/helpers/coworker-workspace-access";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import {
  coworkerWorkspaceAccessesSchema,
  coworkerWorkspaceAccessSchema,
} from "@/schemas/coworker-workspace-access.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/coworker-access",
  description:
    "List coworker workspace access rows for an organization workspace. Owner/admin only.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      coworkerWorkspaceAccessesSchema,
      "List coworker workspace access",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

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

    const rows = await listCoworkerAccessForWorkspace(workspace.id);

    return ok(
      c,
      coworkerWorkspaceAccessesSchema.parse(
        rows.map((row) =>
          coworkerWorkspaceAccessSchema.parse(
            toCoworkerWorkspaceAccessApiShape(row),
          ),
        ),
      ),
    );
  });
}
