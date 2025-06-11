import { Prisma } from "@/prisma/generated/client";

export const invitationOrganizationInclude = {
  organization: true,
} as const;

export const invitationInviterInclude = {
  inviter: true,
} as const;

export const invitationInclude = {
  ...invitationOrganizationInclude,
  ...invitationInviterInclude,
} as const;

export type InvitationWithOrganization = Prisma.InvitationGetPayload<{
  include: typeof invitationOrganizationInclude;
}>;

export type InvitationWithInviter = Prisma.InvitationGetPayload<{
  include: typeof invitationInviterInclude;
}>;

export type InvitationWithRelations = Prisma.InvitationGetPayload<{
  include: typeof invitationInclude;
}>;
