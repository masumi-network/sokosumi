import { Invitation, MemberWithUser } from "@sokosumi/database";

export interface MemberRowData {
  name?: string | undefined;
  email: string;
  role: string;
  member?: MemberWithUser | undefined;
  invitation?: Invitation | undefined;
}
