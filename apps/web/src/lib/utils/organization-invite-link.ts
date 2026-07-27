import type { OrganizationInviteLink } from "@/lib/clients/generated/core";

export type InviteLinkDisplayStatus =
  | "valid"
  | "expired"
  | "revoked"
  | "depleted";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Mirrors Core `evaluateInviteLinkStatus` priority: revoked → expired →
 * depleted → valid.
 */
export function evaluateInviteLinkDisplayStatus(
  link: OrganizationInviteLink,
  now = new Date(),
): InviteLinkDisplayStatus {
  if (link.revokedAt) {
    return "revoked";
  }

  const expiresAt = toDate(link.expiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }

  if (link.maxUses !== null && link.useCount >= link.maxUses) {
    return "depleted";
  }

  return "valid";
}

export function canRevokeInviteLink(
  link: OrganizationInviteLink,
  now = new Date(),
): boolean {
  return evaluateInviteLinkDisplayStatus(link, now) !== "revoked";
}
