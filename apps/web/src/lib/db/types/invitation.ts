import { Prisma } from "@/prisma/generated/client";

export enum InvitationStatus {
  PENDING = "pending",
  ACCEPTED = "accepted",
  REJECTED = "rejected",
  CANCELED = "canceled",
  // This option is not used in the database, but it is used in the frontend to indicate that the invitation has expired
  EXPIRED = "expired",
}

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
