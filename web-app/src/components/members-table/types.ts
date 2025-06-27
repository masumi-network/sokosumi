import { MemberWithUser } from "@/lib/db/member/types";
import { Invitation } from "@/prisma/generated/client";

export interface MemberRowData {
  name?: string | undefined;
  email: string;
  role: string;
  member?: MemberWithUser | undefined;
  invitation?: Invitation | undefined;
}
