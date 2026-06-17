import type { Session } from "@sokosumi/utils";
import { Suspense } from "react";
import { userService } from "@/lib/services";

import UserAvatarClient from "./user-avatar.client";
import UserAvatarSkeleton from "./user-avatar-skeleton";

interface UserAvatarProps {
  secondaryLabel?: string;
  session: Session;
}

export default async function UserAvatar({
  secondaryLabel,
  session,
}: UserAvatarProps) {
  return (
    <Suspense fallback={<UserAvatarSkeleton />}>
      <UserAvatarInner session={session} secondaryLabel={secondaryLabel} />
    </Suspense>
  );
}

async function UserAvatarInner({
  session,
  secondaryLabel,
}: {
  secondaryLabel: string | undefined;
  session: Session;
}) {
  const members = await userService.getMyMembersWithOrganizations();
  const activeOrganizationId = session.session.activeOrganizationId ?? null;

  return (
    <UserAvatarClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={activeOrganizationId}
      secondaryLabel={secondaryLabel}
    />
  );
}
