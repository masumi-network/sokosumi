import { Prisma } from "@/prisma/generated/client";

export const memberOrganizationInclude = {
  organization: true,
} as const;

export const memberOrderBy = [
  {
    role: "desc", // This will put ADMIN first since it's alphabetically after MEMBER
  },
  {
    createdAt: "desc", // This will sort by creation date, newest first
  },
] as const;

export type MemberWithOrganization = Prisma.MemberGetPayload<{
  include: typeof memberOrganizationInclude;
}>;
