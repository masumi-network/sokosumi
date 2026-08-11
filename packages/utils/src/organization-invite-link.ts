/**
 * Pure invite-link usability classification shared by Core and web.
 * No Prisma / I/O — structural fields only so Prisma rows and Core DTOs both work.
 */

export type InviteLinkStatus =
  | "valid"
  | "expired"
  | "revoked"
  | "depleted"
  | "not_found";

export type InviteLinkPresentStatus = Exclude<InviteLinkStatus, "not_found">;

export interface InviteLinkStatusFields {
  revokedAt: Date | string | null;
  /** Null/undefined = no hard expiry (never expires by time). */
  expiresAt: Date | string | null;
  maxUses: number | null;
  useCount: number;
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/**
 * Classify an invite-link row's usability at `now` (defaults to current time).
 * Priority: revoked → expired → depleted → valid.
 * `not_found` only when `link` is null. Null `expiresAt` never expires by time.
 */
export function evaluateInviteLinkStatus(
  link: InviteLinkStatusFields,
  now?: Date,
): InviteLinkPresentStatus;
export function evaluateInviteLinkStatus(link: null, now?: Date): "not_found";
export function evaluateInviteLinkStatus(
  link: InviteLinkStatusFields | null,
  now?: Date,
): InviteLinkStatus;
export function evaluateInviteLinkStatus(
  link: InviteLinkStatusFields | null,
  now: Date = new Date(),
): InviteLinkStatus {
  if (!link) return "not_found";
  if (link.revokedAt) return "revoked";
  if (link.expiresAt != null && toTime(link.expiresAt) <= now.getTime()) {
    return "expired";
  }
  if (link.maxUses !== null && link.useCount >= link.maxUses) return "depleted";
  return "valid";
}

export function canRevokeInviteLink(
  link: InviteLinkStatusFields,
  now: Date = new Date(),
): boolean {
  return evaluateInviteLinkStatus(link, now) !== "revoked";
}
