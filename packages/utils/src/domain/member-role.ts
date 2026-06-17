/**
 * Organization member roles. Stored as strings in Postgres; mirrored here as a
 * const map (not a TS enum) for client-safe use in web.
 */
export const MemberRole = {
  OWNER: "owner",
  ADMIN: "admin",
  MEMBER: "member",
} as const;

export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
