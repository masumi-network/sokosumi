import type { Invitation } from "@sokosumi/utils";

import type { Member as OrganizationMember } from "@/lib/clients/generated/core";

export type { OrganizationMember };

export interface MemberRowData {
  name?: string | undefined;
  email: string;
  role: string;
  lastSeenAt?: Date | null | undefined;
  member?: OrganizationMember | undefined;
  invitation?: Invitation | undefined;
}
