import type { Member as OrganizationMember } from "@/lib/clients/generated/core";
import type { PendingInvitation } from "@/lib/types/core-dto";

export type { OrganizationMember };

export interface MemberRowData {
  name?: string | undefined;
  email: string;
  role: string;
  lastSeenAt?: Date | null | undefined;
  member?: OrganizationMember | undefined;
  invitation?: PendingInvitation | undefined;
}
