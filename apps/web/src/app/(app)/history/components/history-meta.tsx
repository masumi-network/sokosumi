"use client";

import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
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

  return (
    <UserProfileAvatar
      name={owner.name}
      image={owner.image}
      size="sm"
      showTooltip
      className={className}
    />
  );
}
