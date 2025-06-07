import { Prisma } from "@/prisma/generated/client";

export const memberOrganizationInclude = {
  organization: true,
} as const;

export const memberUserInclude = {
  user: true,
} as const;

export const memberOrderBy = [
  {
    role: "asc", // This will put admin before member
  },
  {
    createdAt: "desc", // This will sort by creation date, newest first
  },
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
