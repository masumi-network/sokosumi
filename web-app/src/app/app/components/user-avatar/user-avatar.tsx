import { redirect } from "next/navigation";
import { Suspense } from "react";

import { getSession } from "@/lib/auth/utils";
import { listMyMembers } from "@/lib/services";

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
  const members = await listMyMembers();

  return (
    <UserAvatarClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={session.session.activeOrganizationId ?? null}
    />
  );
}
