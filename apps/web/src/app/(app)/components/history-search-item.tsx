"use client";

import type { HistoryItem } from "@sokosumi/core-client";
import { ImagePlus, ListTodo } from "lucide-react";
import { AgentIcon } from "@/components/agents/agent-icon";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import { cn } from "@/lib/utils";

/**
 * Presentation for one Cmd+K result.
 *
 * The palette reads the `history` feed — every task, job and image, charged or
 * not — while the Transactions page reads the credit ledger. The two
 * item unions have nothing in common but a title, so the palette carries its
 * own row parts rather than sharing the page's and widening both types until
 * neither is exhaustive.
 */
export function HistorySearchItemIcon({
  item,
  className = "size-4",
}: {
  item: HistoryItem;
  className?: string;
}) {
  if (item.kind === "task") {
    return <ListTodo className={className} aria-hidden />;
  }

  // Before the agent branch below: an image row has no agent, and reading
  // `agentName` off one is how this component learned about a third kind.
  if (item.kind === "image") {
    return <ImagePlus className={className} aria-hidden />;
  }

  return (
    <AgentIcon
      agent={{
        name: item.agentName ?? item.title,
        icon: item.agentIcon ?? null,
      }}
      className={className}
    />
  );
}

/**
 * When the result was created, as a date.
 *
 * Absolute rather than "2 days ago", and creation rather than last update, for
 * the same reason the Transactions list is: `history.sortAt` used to
 * come from the source row's `updatedAt`, so a backfill on an unrelated column
 * made a year of results read "Yesterday". A relative label is what hid it.
 * This is the date the entity's own card shows, so the two can be compared.
 */
export function HistorySearchItemTime({
  createdAt,
  formatShortDate,
  createdLabel,
  className,
}: {
  createdAt: string | Date;
  formatShortDate: (date: string | Date) => string;
  createdLabel: string;
  className?: string;
}) {
  const dateTime =
    createdAt instanceof Date ? createdAt.toISOString() : createdAt;

  return (
    <time
      dateTime={dateTime}
      className={cn(
        "text-muted-foreground text-xs whitespace-nowrap",
        className,
      )}
      title={createdLabel}
    >
      {formatShortDate(createdAt)}
    </time>
  );
}

export function HistorySearchItemOwner({
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
