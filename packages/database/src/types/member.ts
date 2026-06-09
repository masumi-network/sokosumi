import type { Prisma } from "../generated/prisma/client.js";

export const memberOrganizationInclude = {
  organization: true,
} as const;

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

export const memberInclude = {
  ...memberOrganizationInclude,
  ...memberUserInclude,
} as const;

export type MemberWithOrganization = Prisma.MemberGetPayload<{
  include: typeof memberOrganizationInclude;
}>;

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

export type MemberWithRelations = Prisma.MemberGetPayload<{
  include: typeof memberInclude;
}>;
