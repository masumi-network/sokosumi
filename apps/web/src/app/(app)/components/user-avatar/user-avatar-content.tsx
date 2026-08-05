import { UserIcon } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface UserAvatarContentProps {
  className?: string;
  imageUrl?: string;
  imageAlt?: string;
}

export default function UserAvatarContent({
  className,
  imageUrl,
  imageAlt,
}: UserAvatarContentProps) {
  return (
    <>
      <Avatar className={cn("size-8", className)}>
        {imageUrl && (
          <AvatarImage
            src={imageUrl}
            alt={imageAlt ?? "User avatar"}
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
        <AvatarFallback className={className}>
          <UserIcon className="text-muted-foreground" />
        </AvatarFallback>
      </Avatar>
    </>
  );
}
