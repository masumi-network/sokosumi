import "server-only";

import { getSession } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services/user.service";
import type { CoworkerOption } from "@/lib/types/coworker";

import { getUserOptions } from "./coworker-options";

const MEMBERS_VENDOR = {
  id: "workspace-members",
  name: "Members",
  slug: "workspace-members",
  logos: { light: null, dark: null },
} as const;

function personalMemberOption(user: {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
}): CoworkerOption {
  return {
    id: user.id,
    slug: (user.email ?? user.id).toLowerCase(),
    name: user.name?.trim() || user.email || "Me",
    kind: "user" as const,
    image: user.image ?? "",
    vendor: { ...MEMBERS_VENDOR },
  };
}

/**
 * Workspace members as task-assignee options (SOK-868). Organization
 * workspaces list org members; personal workspaces fall back to the owner.
 * Server-only: reads the session and Core members API.
 */
export async function listTaskAssigneeMemberOptions(
  organizationId: string | null,
): Promise<CoworkerOption[]> {
  let orgMembers: Awaited<
    ReturnType<typeof userService.getOrganizationMembers>
  > = [];
  if (organizationId) {
    try {
      orgMembers = await userService.getOrganizationMembers(organizationId);
    } catch (error) {
      console.error("Failed to load organization members for assignee picker", {
        organizationId,
        error,
      });
    }
  }
  if (orgMembers.length > 0) {
    return getUserOptions(orgMembers);
  }

  const session = await getSession();
  return session?.user ? [personalMemberOption(session.user)] : [];
}
