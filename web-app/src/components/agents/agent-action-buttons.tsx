"use client";

import { ArrowLeft, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AgentBookmarkButton } from "@/components/agents/agent-bookmark-button";
import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentWithRelations } from "@/lib/db";
import { cn } from "@/lib/utils";

interface AgentActionButtonsProps {
  agent: AgentWithRelations;
  favoriteAgents?: AgentWithRelations[] | undefined;
  showBackButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
  className?: string | undefined;
}

function AgentActionButtons({
  agent,
  favoriteAgents,
  showBackButton = true,
  showCloseButton = false,
  onClose,
  className,
}: AgentActionButtonsProps) {
  const router = useRouter();
  const [url, setUrl] = useState<URL | undefined>(undefined);
  const isFavorite = favoriteAgents?.some(
    (favoriteAgent) => favoriteAgent.id === agent.id,
  );

  useEffect(() => {
    setUrl(new URL(`${window.location.origin}/agents/${agent.id}`));
  }, [agent.id]);

  const onBack = () => {
    router.back();
  };

  return (
    <div className={cn("flex w-full items-center justify-between", className)}>
      <div className="flex items-center gap-2">
        {showBackButton && (
          <Button size="icon" variant="secondary" onClick={onBack}>
            <ArrowLeft />
          </Button>
        )}
        {showCloseButton && !!onClose && (
          <Button size="icon" variant="secondary" onClick={onClose}>
            <X />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {favoriteAgents && (
          <AgentBookmarkButton
            agentId={agent.id}
            isFavorite={isFavorite ?? false}
          />
        )}
        {url && <ShareButton url={url} />}
      </div>
    </div>
  );
}

function AgentActionButtonsSkeleton() {
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

export { AgentActionButtons, AgentActionButtonsSkeleton };
