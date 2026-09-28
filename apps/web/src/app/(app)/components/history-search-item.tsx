"use client";

import { ImagePlus, ListTodo } from "lucide-react";

import { AgentIcon } from "@/components/agents/agent-icon";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import type { HistoryItem } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";

/**
 * Presentation for one Cmd+K result.
 *
 * The palette reads the `history` feed — every task, job and image, charged or
 * not — while the Transaction History page reads the credit ledger. The two
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

export function HistorySearchItemTime({
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
        "text-muted-foreground text-xs whitespace-nowrap capitalize",
        className,
      )}
      title={updatedLabel}
    >
      {formatTimeAgo(updatedAt)}
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
