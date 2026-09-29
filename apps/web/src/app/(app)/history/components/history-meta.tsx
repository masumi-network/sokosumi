"use client";

import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import type { TransactionHistoryItem } from "@/lib/services/history.service";
import { cn } from "@/lib/utils";

/**
 * The date credits were taken, as a date.
 *
 * Deliberately absolute rather than "2 days ago": this list answers "when was I
 * charged for this", and a relative label is exactly what made a year of
 * entries read as "Yesterday".
 */
export function HistoryMetaTime({
  consumedAt,
  formatShortDate,
  consumedLabel,
  className,
}: {
  consumedAt: string | Date;
  formatShortDate: (date: string | Date) => string;
  consumedLabel: string;
  className?: string;
}) {
  const dateTime =
    consumedAt instanceof Date ? consumedAt.toISOString() : consumedAt;

  return (
    <time
      dateTime={dateTime}
      className={cn(
        "text-muted-foreground whitespace-nowrap text-xs sm:text-right",
        className,
      )}
      title={consumedLabel}
    >
      {formatShortDate(consumedAt)}
    </time>
  );
}

export function HistoryOwnerAvatar({
  owner,
  className,
}: {
  owner: TransactionHistoryItem["owner"];
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
