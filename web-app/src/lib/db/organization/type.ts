import { Prisma } from "@/prisma/generated/client";

export const organizationMembersCountInclude = {
  _count: {
    select: {
      members: true,
    },
  },
} as const;

export type OrganizationWithMembersCount = Prisma.OrganizationGetPayload<{
  include: typeof organizationMembersCountInclude;
}>;
