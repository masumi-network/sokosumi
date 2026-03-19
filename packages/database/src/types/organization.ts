import type { Organization, Prisma } from "../generated/prisma/client.js";

export enum MemberRole {
  OWNER = "owner",
  ADMIN = "admin",
  MEMBER = "member",
}

export const organizationMembersCountInclude = {
  _count: {
    select: {
      members: true,
    },
  },
} as const;

export const organizationOrderBy = {
  members: {
    _count: "desc",
  },
} as const;

export const organizationInclude = {
  ...organizationMembersCountInclude,
} as const;

export const organizationLimitedInfoInclude = {
  id: true,
  name: true,
  slug: true,
} as const;

/** Base organization scalars plus members count from {@link organizationInclude}. */
export type OrganizationWithRelations = Organization & {
  _count: { members: number };
};

export type OrganizationWithLimitedInfo = Prisma.OrganizationGetPayload<{
  select: typeof organizationLimitedInfoInclude;
}>;
