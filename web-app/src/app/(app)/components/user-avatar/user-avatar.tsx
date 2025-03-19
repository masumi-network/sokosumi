import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/better-auth/auth";

import UserAvatarClient from "./user-avatar.client";
import UserAvatarContent from "./user-avatar-content";

function UserAvatarSkeleton() {
  return (
    <Button
      variant="outline"
      className="relative h-8 w-8 rounded-full"
      aria-label="Loading user profile"
      disabled
    >
      <UserAvatarContent className="animate-pulse" />
    </Button>
  );
}

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
    redirect("/signin");
  }

  return <UserAvatarClient user={session.user} />;
}
