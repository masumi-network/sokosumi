import { MemberWithOrganization } from "@sokosumi/database";
import { Suspense } from "react";

import { Session } from "@/lib/auth/auth";
import { userService } from "@/lib/services";

import UserAvatarClient from "./user-avatar.client";
import UserAvatarSkeleton from "./user-avatar-skeleton";

interface UserAvatarProps {
  creditsLabel?: string;
  primaryLabel?: string;
  secondaryLabel?: string;
  session: Session;
}

const PERSONAL_WORKSPACE_KEY = "personal-account";

function getWorkspacePlanLabels(
  members: MemberWithOrganization[],
  _activeOrganizationId: string | null,
): Record<string, string> {
  // Return empty labels for all workspaces to avoid O(n) API calls
  // The active workspace shows credits instead, and non-active workspaces
  // don't need plan labels in the dropdown for performance reasons
  const workspacePlanEntries: [string, string][] = [
    [PERSONAL_WORKSPACE_KEY, ""],
    ...members.map(
      (member) => [member.organization.id, ""] as [string, string],
    ),
  ];

  return Object.fromEntries(workspacePlanEntries);
}

export default async function UserAvatar({
  creditsLabel,
  primaryLabel,
  secondaryLabel,
  session,
}: UserAvatarProps) {
  return (
    <Suspense fallback={<UserAvatarSkeleton />}>
      <UserAvatarInner
        session={session}
        creditsLabel={creditsLabel}
        primaryLabel={primaryLabel}
        secondaryLabel={secondaryLabel}
      />
    </Suspense>
  );
}

async function UserAvatarInner({
  session,
  creditsLabel,
  primaryLabel,
  secondaryLabel,
}: {
  creditsLabel: string | undefined;
  primaryLabel: string | undefined;
  secondaryLabel: string | undefined;
  session: Session;
}) {
  const members = await userService.getMyMembersWithOrganizations();
  const activeOrganizationId = session.session.activeOrganizationId ?? null;
  const workspacePlanLabels = getWorkspacePlanLabels(
    members,
    activeOrganizationId,
  );

  return (
    <UserAvatarClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={activeOrganizationId}
      creditsLabel={creditsLabel}
      primaryLabel={primaryLabel}
      secondaryLabel={secondaryLabel}
      workspacePlanLabels={workspacePlanLabels}
    />
  );
}
