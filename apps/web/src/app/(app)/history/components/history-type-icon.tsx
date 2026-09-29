"use client";

import { ImagePlus, ListTodo } from "lucide-react";

import { AgentIcon } from "@/components/agents/agent-icon";
import type { HistoryItem } from "@/lib/services/history.service";

interface HistoryTypeIconProps {
  item: HistoryItem;
  className?: string;
}

/**
 * The feature a row came from, as its own icon.
 *
 * Tasks and images carry the icon their sidebar entry carries, so a row is
 * recognisable as "one of those"; a job carries the coworker that ran it,
 * because which agent it was is the useful fact about a job and there are many.
 */
export function HistoryTypeIcon({
  item,
  className = "size-4",
}: HistoryTypeIconProps) {
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
