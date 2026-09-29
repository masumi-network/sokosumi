import { InvitationStatus } from "@sokosumi/core-client";

export const InvitationDisplayStatus = {
  ...InvitationStatus,
  EXPIRED: "expired",
} as const;
