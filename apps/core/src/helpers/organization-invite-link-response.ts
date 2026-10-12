import type { OrganizationInviteLink } from "@sokosumi/database";

import { organizationInviteLinkSchema } from "@/schemas/organization-invite-link.schema";

import { buildWebAppUrl } from "./web-app-url";

/**
 * Maps a Prisma invite-link row to the shared OpenAPI response DTO
 * (including the shareable `{webBase}/join/{token}` URL).
 */
export function toOrganizationInviteLinkResponse(link: OrganizationInviteLink) {
  return organizationInviteLinkSchema.parse({
    token: link.token,
    url: buildWebAppUrl(`/join/${link.token}`),
    role: link.role,
    createdAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    revokedAt: link.revokedAt?.toISOString() ?? null,
    maxUses: link.maxUses,
    useCount: link.useCount,
  });
}
