import type { Prisma } from "../generated/prisma/client";

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

export type MemberWithRelations = Prisma.MemberGetPayload<{
  include: typeof memberInclude;
}>;
