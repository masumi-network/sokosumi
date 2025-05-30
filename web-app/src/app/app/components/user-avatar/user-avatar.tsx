import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSession } from "@/lib/auth/utils";

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
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <UserAvatarClient sessionUser={session.user} />;
}
