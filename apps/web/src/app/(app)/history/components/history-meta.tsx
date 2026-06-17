"use client";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { User } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { HistoryItem } from "@/lib/services/history.service";
import { cn } from "@/lib/utils";

export function HistoryMetaTime({
  updatedAt,
  formatTimeAgo,
  updatedLabel,
  className,
}: {
  updatedAt: string | Date;
  formatTimeAgo: (date: string | Date) => string;
  updatedLabel: string;
  className?: string;
}) {
  const dateTime =
    updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;

  return (
    <time
      dateTime={dateTime}
      className={cn(
        "text-muted-foreground whitespace-nowrap text-xs capitalize sm:text-right",
        className,
      )}
      title={updatedLabel}
    >
      {formatTimeAgo(updatedAt)}
    </time>
  );
}

export function HistoryOwnerAvatar({
  owner,
  className,
}: {
  owner: HistoryItem["owner"];
  className?: string;
}) {
  if (!owner) {
    return null;
  }

  const image = owner.image ? resolveIpfsOrHttpUrl(owner.image) : null;
  const ownerName = owner.name.trim();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex", className)}>
          <Avatar className="size-5 ring-background shrink-0 ring-2">
            {image ? (
              <AvatarImage
                src={image}
                alt={ownerName || "User"}
                className="object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            ) : null}
            <AvatarFallback className="bg-muted text-[10px] font-medium">
              {ownerName.slice(0, 1).toUpperCase() || (
                <User className="size-3" aria-hidden />
              )}
            </AvatarFallback>
          </Avatar>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {ownerName}
      </TooltipContent>
    </Tooltip>
  );
}
