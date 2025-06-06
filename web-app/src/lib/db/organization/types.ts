import { Prisma } from "@/prisma/generated/client";

export enum MemberRole {
  ADMIN = "admin",
  OWNER = "owner",
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

export type OrganizationWithRelations = Prisma.OrganizationGetPayload<{
  include: typeof organizationInclude;
}>;
