import { InvitationStatus } from "@/lib/clients/generated/core";

export const InvitationDisplayStatus = {
  ...InvitationStatus,
  EXPIRED: "expired",
} as const;
