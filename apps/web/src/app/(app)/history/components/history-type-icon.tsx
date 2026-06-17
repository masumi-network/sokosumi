"use client";

import { ListTodo } from "lucide-react";

import type { HistoryBucketLookups } from "@/app/history/utils/history-row-subtitle";
import { AgentIcon } from "@/components/agents/agent-icon";
import { ChatModelIcon } from "@/components/chat/chat-model-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { HistoryItem } from "@/lib/services/history.service";

interface HistoryTypeIconLabels {
  kind: {
    task: string;
    job: string;
    conversation: string;
  };
}

interface HistoryTypeIconProps {
  item: HistoryItem;
  bucketLookups: HistoryBucketLookups;
  labels: HistoryTypeIconLabels;
  className?: string;
}

export function HistoryTypeIcon({
  item,
  bucketLookups,
  labels,
  className = "size-4",
}: HistoryTypeIconProps) {
  if (item.kind === "task") {
    return <ListTodo className={className} aria-hidden />;
  }

  if (item.kind === "job") {
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

  const bucketIcon = item.bucketSlug
    ? bucketLookups.bucketIconBySlug[item.bucketSlug]
    : undefined;

  return (
    <HistoryConversationIcon
      bucketIcon={bucketIcon}
      fallbackLabel={labels.kind.conversation}
      className={className}
    />
  );
}

function HistoryConversationIcon({
  bucketIcon,
  fallbackLabel,
  className,
}: {
  bucketIcon: HistoryBucketLookups["bucketIconBySlug"][string] | undefined;
  fallbackLabel: string;
  className: string;
}) {
  if (bucketIcon?.kind === "model") {
    return (
      <ChatModelIcon
        modelId={bucketIcon.modelId}
        modelName={bucketIcon.modelName}
        className={className}
        size={16}
      />
    );
  }

  if (bucketIcon?.kind === "coworker") {
    return (
      <Avatar className={className}>
        {bucketIcon.imageUrl ? (
          <AvatarImage src={bucketIcon.imageUrl} alt={bucketIcon.name} />
        ) : null}
        <AvatarFallback className="bg-primary text-primary-foreground text-[8px]">
          {bucketIcon.name.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    );
  }

  return (
    <ChatModelIcon
      modelId=""
      modelName={fallbackLabel}
      className={className}
      size={16}
    />
  );
}
