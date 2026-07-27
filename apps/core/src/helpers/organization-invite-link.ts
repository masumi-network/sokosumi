import type { OrganizationInviteLink } from "@sokosumi/database";

export type InviteLinkStatus =
  | "valid"
  | "expired"
  | "revoked"
  | "depleted"
  | "not_found";

/**
 * Pure classification of an invite-link row's usability at instant `now`.
 * `not_found` is the caller's job (null row); this maps a present row to one
 * of the live/dead states, checked in priority order (revoked → expired →
 * depleted → valid).
 */
export function evaluateInviteLinkStatus(
  link: OrganizationInviteLink | null,
  now: Date,
): InviteLinkStatus {
  if (!link) return "not_found";
  if (link.revokedAt) return "revoked";
  if (link.expiresAt.getTime() <= now.getTime()) return "expired";
  if (link.maxUses !== null && link.useCount >= link.maxUses) return "depleted";
  return "valid";
}
