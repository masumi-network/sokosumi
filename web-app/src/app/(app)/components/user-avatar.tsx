import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth";

import UserAvatarClient from "./user-avatar.client";

function UserAvatarSkeleton() {
  return (
    <Button variant="outline" className="relative h-8 w-8 rounded-full">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="bg-muted animate-pulse" />
      </Avatar>
    </Button>
  );
}

export default async function UserAvatar() {
  const session = await getSession();
  const user = session?.user;

  if (!user) {
    return <UserAvatarSkeleton />;
  }

  return <UserAvatarClient user={user} />;
}
