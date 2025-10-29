import { Button } from "@/components/ui/button";

import UserAvatarContent from "./user-avatar-content";

interface UserAvatarSkeletonProps {
  noAnimation?: boolean;
}

export default function UserAvatarSkeleton({
  noAnimation,
}: UserAvatarSkeletonProps) {
  return (
    <Button
      variant="outline"
      className="relative h-8 w-8 rounded-full"
      aria-label="Loading user profile"
      disabled
    >
      <UserAvatarContent className={noAnimation ? "" : "animate-pulse"} />
    </Button>
  );
}
