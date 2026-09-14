import type { Prisma } from "../generated/prisma/client.js";

export const InvitationStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CANCELED: "canceled",
} as const;

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

export type InvitationWithRelations = Prisma.InvitationGetPayload<{
  include: typeof invitationInclude;
}>;
