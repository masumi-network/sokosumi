import { UserIcon } from "lucide-react";
import { Suspense } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/better-auth/auth";

import UserAvatarClient from "./user-avatar.client";

function UserAvatarSkeleton() {
  return (
    <Button
      variant="outline"
      className="relative h-8 w-8 rounded-full"
      aria-label="Loading user profile"
      disabled
    >
      <Avatar className="h-8 w-8">
        <AvatarFallback className="animate-pulse">
          <UserIcon className="text-muted-foreground" />
        </AvatarFallback>
      </Avatar>
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
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const session = await getSession();
  return <UserAvatarClient user={session.user} />;
}
