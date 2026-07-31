"use client";

import { ListTodo } from "lucide-react";

import { AgentIcon } from "@/components/agents/agent-icon";
import type { HistoryItem } from "@/lib/services/history.service";

interface HistoryTypeIconProps {
  item: HistoryItem;
  className?: string;
}

export function HistoryTypeIcon({
  item,
  className = "size-4",
}: HistoryTypeIconProps) {
  if (item.kind === "task") {
    return <ListTodo className={className} aria-hidden />;
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
