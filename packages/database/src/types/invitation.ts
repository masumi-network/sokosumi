import type { Prisma } from "../generated/prisma/client.js";

export const InvitationStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CANCELED: "canceled",
} as const;

export const invitationInclude = {
  organization: true,
  inviter: true,
} as const;

export type InvitationWithRelations = Prisma.InvitationGetPayload<{
  include: typeof invitationInclude;
}>;
