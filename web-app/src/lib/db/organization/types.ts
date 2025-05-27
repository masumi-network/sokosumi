import { Prisma } from "@/prisma/generated/client";

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

export type OrganizationWithMembersCount = Prisma.OrganizationGetPayload<{
  include: typeof organizationMembersCountInclude;
}>;

export const organizationInclude = {
  ...organizationMembersCountInclude,
} as const;

export type OrganizationWithRelations = Prisma.OrganizationGetPayload<{
  include: typeof organizationInclude;
}>;
