import type { Invitation, MemberWithUser } from "@sokosumi/database";

export interface MemberRowData {
  name?: string | undefined;
  email: string;
  role: string;
  lastSeenAt?: Date | null | undefined;
  member?: MemberWithUser | undefined;
  invitation?: Invitation | undefined;
}
