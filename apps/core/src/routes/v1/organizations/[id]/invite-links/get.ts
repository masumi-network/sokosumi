import { createRoute, z } from "@hono/zod-openapi";
import type { OrganizationInviteLink } from "@sokosumi/database";
import { MemberRole } from "@sokosumi/database";
import { organizationInviteLinkRepository } from "@sokosumi/database/repositories";

import { getWebAppBaseUrl } from "@/config/env";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { organizationInviteLinkSchema } from "@/schemas/organization-invite-link.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

function toInviteLinkResponse(link: OrganizationInviteLink) {
  return organizationInviteLinkSchema.parse({
    token: link.token,
    url: `${getWebAppBaseUrl()}/join/${link.token}`,
    role: link.role,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    revokedAt: link.revokedAt?.toISOString() ?? null,
    maxUses: link.maxUses,
    useCount: link.useCount,
  });
}

const route = createRoute({
  method: "get",
  path: "/{id}/invite-links",
  description:
    "List shareable invite links for an organization. Owners and admins only. Sorted by createdAt descending (newest first).",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(organizationInviteLinkSchema),
      "List organization invite links",
      {
        data: [
          {
            token: "tok_abc",
            url: "https://app.sokosumi.com/join/tok_abc",
            role: "member",
            createdAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-01-08T00:00:00.000Z",
            revokedAt: null,
            maxUses: null,
            useCount: 0,
          },
        ],
        meta: {
          timestamp: "2026-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden - owner or admin only"),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Session-only owner/admin read: coworker/orchestrator keys must not list
    // org invite links on behalf of an impersonated user.
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const links =
      await organizationInviteLinkRepository.listInviteLinksByOrganizationId(
        organization.id,
        prisma,
      );

    // Repository already returns createdAt desc; keep that order.
    const payload = links.map(toInviteLinkResponse);

    return ok(c, z.array(organizationInviteLinkSchema).parse(payload));
  });
}
