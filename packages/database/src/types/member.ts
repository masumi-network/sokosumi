import type { Prisma } from "../generated/prisma/client.js";

export const memberUserInclude = {
  user: true,
} as const;

export const memberRoleOrderBy = {
  role: "asc",
} as const;

export const memberUserNameOrderBy = {
  user: {
    name: "asc",
  },
} as const;

export const memberOrderBy = [
  { ...memberRoleOrderBy },
  { ...memberUserNameOrderBy },
] as const;

/**
 * Oldest membership first. The id breaks ties between memberships created in
 * the same instant, so every reader agrees on which one is first.
 */
export const membershipAgeOrderBy = [
  { createdAt: "asc" },
  { id: "asc" },
] as const;

export type MemberWithUser = Prisma.MemberGetPayload<{
  include: typeof memberUserInclude;
}>;

/**
 * A member with its user relation plus a session-derived `lastSeenAt`
 * timestamp (the most recent `Session.updatedAt` for the user, or `null`
 * if the user has never had a session).
 */
export type MemberWithUserAndLastSeen = MemberWithUser & {
  lastSeenAt: Date | null;
};
