/**
 * Stable machine-readable identifiers carried in the Core API error
 * envelope's optional `kind` field.
 *
 * Consumers (the web app) MUST match on these constants instead of the
 * human-readable `message`, which may be reworded at any time. Values are
 * part of the public API contract: never change an existing value, only add
 * new ones.
 */
export const CORE_API_ERROR_KINDS = {
  INVOICE_INVALID: "invoice_invalid",
  INVOICE_NOT_FOUND: "invoice_not_found",
  MEMBER_NOT_FOUND: "member_not_found",
  ORGANIZATION_MEMBERSHIP_REQUIRED: "organization_membership_required",
  ORGANIZATION_NOT_FOUND: "organization_not_found",
  ORGANIZATION_ROLE_FORBIDDEN: "organization_role_forbidden",
  SEAT_CAPACITY_EXCEEDED: "seat_capacity_exceeded",
  SUBSCRIPTION_CHANGE_NOT_ALLOWED: "subscription_change_not_allowed",
  SUBSCRIPTION_NOT_ACTIVE: "subscription_not_active",
  SUBSCRIPTION_SEATS_BELOW_ASSIGNED: "subscription_seats_below_assigned",
} as const;

export type CoreApiErrorKind =
  (typeof CORE_API_ERROR_KINDS)[keyof typeof CORE_API_ERROR_KINDS];
