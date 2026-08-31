import "server-only";

import { getSession } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services/user.service";

import type { TaskAssigneeMemberOption } from "./task-assignee";

function sessionUserToMemberOption(user: {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}): TaskAssigneeMemberOption {
  return {
    id: user.id,
    name: user.name?.trim() || user.email?.trim() || "User",
    image: user.image ?? null,
  };
}

/** Personal workspace: the signed-in user. Org workspace: org members. */
export async function listTaskAssigneeMemberOptions(): Promise<
  TaskAssigneeMemberOption[]
> {
  const session = await getSession();
  if (!session?.user?.id) {
    return [];
  }

  const organizationId = session.session.activeOrganizationId ?? null;
  if (!organizationId) {
    return [sessionUserToMemberOption(session.user)];
  }

  try {
    const members = await userService.getOrganizationMembers(organizationId);
    return members.map((member) => ({
      id: member.user.id,
      name: member.user.name,
      image: member.user.image,
    }));
  } catch {
    return [sessionUserToMemberOption(session.user)];
  }
}
