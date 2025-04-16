"use client";

import { Bookmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { toggleAgentInList } from "@/lib/actions/agent.actions";
import { AgentListWithAgent } from "@/lib/db";
import { cn } from "@/lib/utils";

interface AgentBookmarkButtonProps {
  agentId: string;
  agentList: AgentListWithAgent;
  className?: string;
}

export function AgentBookmarkButton({
  agentId,
  agentList,
  className,
}: AgentBookmarkButtonProps) {
  const t = useTranslations("Components.Agents.AgentCard");
  const [isBookmarked, setIsBookmarked] = useState<boolean>(
    !!agentList?.agents.some((agent) => agent.id === agentId),
  );
  const [isLoading, setIsLoading] = useState(false);

  const handleBookmarkToggle = async () => {
    setIsLoading(true);
    try {
      const result = await toggleAgentInList(
        agentId,
        agentList.id,
        isBookmarked,
      );

      if (result.success) {
        setIsBookmarked(!isBookmarked);
        if (isBookmarked) {
          toast.success(t("removedFromBookmarks"));
        } else {
          toast.success(t("addedToBookmarks"));
        }
      } else {
        toast.error(t("bookmarkError"));
      }
    } catch {
      toast.error(t("bookmarkError"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("!h-9 !w-9", className)}
      onClick={handleBookmarkToggle}
      disabled={isLoading}
    >
      <Bookmark
        fill={isBookmarked ? "currentColor" : "none"}
        className={cn("!h-9 !w-9", isLoading && "animate-pulse")}
      />
    </Button>
  );
}
