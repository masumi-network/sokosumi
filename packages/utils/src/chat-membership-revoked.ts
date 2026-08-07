/**
 * Shared Ably contract for chat membership revoke (SOK-742).
 * Core publishes; web parses — keep event name and reasons in one place.
 */

export const CHAT_MEMBERSHIP_REVOKED_EVENT_NAME = "chat_membership_revoked";

export const CHAT_MEMBERSHIP_REVOKE_REASONS = ["removed", "left"] as const;

export type ChatMembershipRevokeReason =
  (typeof CHAT_MEMBERSHIP_REVOKE_REASONS)[number];
