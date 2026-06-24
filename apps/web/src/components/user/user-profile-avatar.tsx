"use client";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { User } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface UserProfileAvatarProps {
  name: string;
  image?: string | null;
  size?: "sm" | "md";
  showTooltip?: boolean;
  className?: string;
}

export function UserProfileAvatar({
  name,
  image,
  size = "sm",
  showTooltip = false,
  className,
}: UserProfileAvatarProps) {
  const resolvedImage = image ? resolveIpfsOrHttpUrl(image) : null;
  const sizeClass = size === "sm" ? "size-5" : "size-6";
  const userName = name.trim();

  const avatarContent = (
    <span className={cn("inline-flex", className)}>
      <Avatar className={cn(sizeClass, "ring-background shrink-0 ring-2")}>
        {resolvedImage ? (
          <AvatarImage
            src={resolvedImage}
            alt={userName || "User"}
            className="object-cover"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        ) : null}
        <AvatarFallback className="bg-muted text-[10px] font-medium">
          {userName.slice(0, 1).toUpperCase() || (
            <User className="size-3" aria-hidden />
          )}
        </AvatarFallback>
      </Avatar>
    </span>
  );

  if (!showTooltip) {
    return avatarContent;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{avatarContent}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {userName}
      </TooltipContent>
    </Tooltip>
  );
}
