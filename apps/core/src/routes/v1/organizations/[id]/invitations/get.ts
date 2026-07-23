import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";

import { listPendingInvitationsByOrganizationId } from "@/helpers/invitation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { pendingInvitationsSchema } from "@/schemas/invitation.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/invitations",
  description:
    "List pending invitations for an organization (owner/admin only), de-duplicated to the most recent invitation per email.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      pendingInvitationsSchema,
      "List pending organization invitations",
      {
        data: [
          {
            id: "inv_123",
            organizationId: "org_123",
            email: "jane@example.com",
            role: "member",
            status: "pending",
            expiresAt: "2025-06-08T14:30:00.000Z",
            inviterId: "user_123",
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You are not an owner or admin of this organization",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const invitations = await listPendingInvitationsByOrganizationId(id);

    return ok(c, pendingInvitationsSchema.parse(invitations));
  });
}
