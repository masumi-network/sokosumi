"use client";

import { Bot, ImagePlus, ListTodo, Plus, Receipt, Users } from "lucide-react";

import { AgentIcon } from "@/components/agents/agent-icon";
import type { TransactionHistoryItem } from "@/lib/services/history.service";

interface HistoryTypeIconProps {
  item: TransactionHistoryItem;
  className?: string;
}

/**
 * The source that consumed the credits, as its own icon.
 *
 * Every source except a job carries the icon its own feature carries, so a row
 * is recognisable as "one of those". A job carries the agent that ran it,
 * because which agent it was is the useful fact about a job and there are many.
 */
export function HistoryTypeIcon({
  item,
  className = "size-4",
}: HistoryTypeIconProps) {
  switch (item.kind) {
    case "task":
      return <ListTodo className={className} aria-hidden />;
    case "image":
      return <ImagePlus className={className} aria-hidden />;
    case "coworker":
      return <Users className={className} aria-hidden />;
    case "sokoBot":
      return <Bot className={className} aria-hidden />;
    case "topUp":
      return <Plus className={className} aria-hidden />;
    case "unattributed":
      return <Receipt className={className} aria-hidden />;
    default:
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
}
