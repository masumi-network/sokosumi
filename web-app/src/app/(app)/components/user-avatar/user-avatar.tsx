import { headers } from "next/headers";
import { Suspense } from "react";

import { auth } from "@/lib/better-auth/auth";

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
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return <UserAvatarSkeleton noAnimation />;
  }

  return <UserAvatarClient user={session.user} />;
}
