import { Suspense } from "react";

import { getSessionUser } from "@/lib/auth/utils";

import UserAvatarClient from "./user-avatar.client";
import UserAvatarSkeleton from "./user-avatar-skeleton";

export default async function UserAvatar() {
  return (
    <Suspense fallback={<UserAvatarSkeleton />}>
      <UserAvatarInner />
    </Suspense>
  );
}

async function UserAvatarInner() {
  const sessionUser = await getSessionUser();

  return <UserAvatarClient sessionUser={sessionUser} />;
}
