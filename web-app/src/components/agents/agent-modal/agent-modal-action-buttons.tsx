"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { AgentBookmarkButton } from "@/components/agents/agent-bookmark-button";
import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentListWithAgent, AgentWithRelations } from "@/lib/db";
import { cn } from "@/lib/utils";

interface AgentModalActionButtonsProps {
  agent: AgentWithRelations;
  agentList?: AgentListWithAgent | undefined;
  onCloseModal: () => void;
  className?: string | undefined;
}

function AgentModalActionButtons({
  agent,
  agentList,
  onCloseModal,
  className,
}: AgentModalActionButtonsProps) {
  const [url, setUrl] = useState<URL | undefined>(undefined);

  useEffect(() => {
    setUrl(new URL(`${window.location.origin}/agents?agentId=${agent.id}`));
  }, [agent.id]);

  return (
    <div className={cn("flex w-full items-center justify-between", className)}>
      <Button size="icon" variant="secondary" onClick={onCloseModal}>
        <ArrowLeft />
      </Button>
      <div className="flex items-center gap-2">
        {agentList && (
          <AgentBookmarkButton agentId={agent.id} agentList={agentList} />
        )}
        {url && <ShareButton url={url} />}
      </div>
    </div>
  );
}

function AgentModalActionButtonsSkeleton() {
  return (
    <div className="flex w-full items-center justify-between">
      <Skeleton className="h-8 w-8" />
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-8 w-8" />
      </div>
    </div>
  );
}

export { AgentModalActionButtons, AgentModalActionButtonsSkeleton };
