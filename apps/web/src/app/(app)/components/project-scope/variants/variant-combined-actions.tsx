"use server";

import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services/user.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export interface CombinedWorkspaces {
  members: MemberWithOrganization[];
  hasPersonalWorkspace: boolean;
}

/**
 * The workspaces the header switcher lists, from the same two service reads
 * its server parent makes. The slot gets no props, so it asks for them.
 */
export const loadCombinedWorkspaces = withSession<
  AuthenticatedRequest,
  CombinedWorkspaces
>(async () => {
  const [members, access] = await Promise.all([
    userService.getMyMembersWithOrganizations(),
    userService.getWorkspaceAccess(),
  ]);
  return {
    members,
    hasPersonalWorkspace: access?.hasPersonalWorkspace ?? false,
  };
});
