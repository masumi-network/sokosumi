"use client";

import { ArrowLeft, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

import { AgentBookmarkButton } from "@/components/agents/agent-bookmark-button";
import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentWithRelations } from "@/lib/db";
import { cn } from "@/lib/utils";

interface AgentActionButtonsProps {
  agent: AgentWithRelations;
  favoriteAgents?: AgentWithRelations[] | undefined;
  showBackButton?: boolean | undefined;
  showShareButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
  className?: string | undefined;
}

function AgentActionButtons({
  agent,
  favoriteAgents,
  showBackButton = true,
  showShareButton = true,
  showCloseButton = false,
  onClose,
  className,
}: AgentActionButtonsProps) {
  const router = useRouter();
  const { isMobile } = useSidebar();

  // Detect client-side rendering without setState in useEffect
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Compute URL only on client to avoid hydration mismatch
  const url = isClient
    ? new URL(`${window.location.origin}/agents/${agent.id}`)
    : undefined;

  const isFavorite = favoriteAgents?.some(
    (favoriteAgent) => favoriteAgent.id === agent.id,
  );

  const onBack = () => {
    // Check if we're inside of jobs/<id> and if it's mobile, redirect to /agents
    if (typeof window !== "undefined") {
      const pathMatch = window.location.pathname.includes("/jobs/");

      if (isMobile && pathMatch) {
        router.push("/agents");
      } else if (window.history.length > 1) {
        router.back();
      } else {
        // Fallback to agents page if no history
        router.push("/agents");
      }
    } else {
      // Server-side fallback
      router.push("/agents");
    }
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
        {showShareButton && url && <ShareButton url={url} />}
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
