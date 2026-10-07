import type {
  Member as OrganizationMember,
  PendingInvitation,
} from "@sokosumi/core-client";

export type { OrganizationMember };

export interface MemberRowData {
  name?: string | undefined;
  email: string;
  role: string;
  lastSeenAt?: Date | null | undefined;
  member?: OrganizationMember | undefined;
  invitation?: PendingInvitation | undefined;
}
