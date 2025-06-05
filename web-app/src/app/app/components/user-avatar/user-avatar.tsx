import { Suspense } from "react";

import { getSessionOrThrow } from "@/lib/auth/utils";

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
  const session = await getSessionOrThrow();

  return <UserAvatarClient sessionUser={session.user} />;
}
