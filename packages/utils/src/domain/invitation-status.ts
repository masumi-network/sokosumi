export const InvitationStatus = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CANCELED: "canceled",
  // Not stored in the database; used in the frontend for expired invitations.
  EXPIRED: "expired",
} as const;

export type InvitationStatus =
  (typeof InvitationStatus)[keyof typeof InvitationStatus];
