import { Prisma } from "@/prisma/generated/client";

export const invitationOrganizationInclude = {
  organization: true,
} as const;

export type InvitationWithOrganization = Prisma.InvitationGetPayload<{
  include: typeof invitationOrganizationInclude;
}>;

export const invitationInvitorInclude = {
  inviter: true,
} as const;

export type InvitationWithInvitor = Prisma.InvitationGetPayload<{
  include: typeof invitationInvitorInclude;
}>;

export const invitationInclude = {
  ...invitationOrganizationInclude,
  ...invitationInvitorInclude,
} as const;

export type InvitationWithRelations = Prisma.InvitationGetPayload<{
  include: typeof invitationInclude;
}>;
