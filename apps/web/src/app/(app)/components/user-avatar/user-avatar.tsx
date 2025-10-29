import { Suspense } from "react";

import { Session } from "@/lib/auth/auth";
import { userService } from "@/lib/services";

import UserAvatarClient from "./user-avatar.client";
import UserAvatarSkeleton from "./user-avatar-skeleton";

interface UserAvatarProps {
  session: Session;
}

export default async function UserAvatar({ session }: UserAvatarProps) {
  return (
    <Suspense fallback={<UserAvatarSkeleton />}>
      <UserAvatarInner session={session} />
    </Suspense>
  );
}

async function UserAvatarInner({ session }: { session: Session }) {
  const members = await userService.getMyMembersWithOrganizations();

  return (
    <UserAvatarClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={session.session.activeOrganizationId ?? null}
    />
  );
}
