import { MemberWithUser } from "@/lib/db";

export interface MemberRowData {
  name?: string | undefined;
  email: string;
  role: string;
  member?: MemberWithUser | undefined;
}
