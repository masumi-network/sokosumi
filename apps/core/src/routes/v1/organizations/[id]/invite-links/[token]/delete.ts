import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { organizationInviteLinkRepository } from "@sokosumi/database/repositories";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
  token: z.string().openapi({
    param: { name: "token", in: "path" },
    description: "Invite link token to revoke",
  }),
});

const responseSchema = z.object({ ok: z.boolean() }).openapi("RevokeResult");

const route = createRoute({
  method: "delete",
  path: "/{id}/invite-links/{token}",
  description:
    "Revoke a shareable invite link so it can no longer be used to join. Owners and admins only.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Revoked"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden - owner or admin only"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only owner/admin action, mirroring the create route.
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id, token } = c.req.valid("param");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const link = await organizationInviteLinkRepository.getInviteLinkByToken(
      token,
      prisma,
    );
    // Scope the token to the path org so an admin of org A can't revoke a
    // link belonging to org B by guessing its token.
    if (!link || link.organizationId !== organization.id) {
      throw notFound("Invite link not found");
    }

    if (!link.revokedAt) {
      await organizationInviteLinkRepository.revokeInviteLink(
        link.id,
        new Date(),
        prisma,
      );
    }

    return ok(c, responseSchema.parse({ ok: true }));
  });
}
