"use client";

import { AgentListType } from "@sokosumi/database";
import { Bookmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { toggleAgentInAgentList } from "@/lib/actions";
import { cn } from "@/lib/utils";

interface AgentBookmarkButtonProps {
  agentId: string;
  isFavorite: boolean;
  className?: string;
  disabled?: boolean;
}

export function AgentBookmarkButton({
  agentId,
  isFavorite,
  className,
  disabled,
}: AgentBookmarkButtonProps) {
  const t = useTranslations("Components.Agents.AgentCard");
  // Use prop directly as initial state; updates come from user interaction
  const [isBookmarked, setIsBookmarked] = useState<boolean>(isFavorite);
  const [isLoading, setIsLoading] = useState(false);

  const handleBookmarkToggle = async () => {
    setIsLoading(true);
    const result = await toggleAgentInAgentList({
      agentId,
      listType: AgentListType.FAVORITE,
      isBookmarked,
    });

    if (result.ok) {
      setIsBookmarked(!isBookmarked);
      if (isBookmarked) {
        toast.success(t("removedFromBookmarks"));
      } else {
        toast.success(t("addedToBookmarks"));
      }
    } else {
      toast.error(t("bookmarkError"));
    }
    setIsLoading(false);
  };

  return (
    <Button
      variant="secondary"
      size="icon"
      className={cn(className)}
      onClick={handleBookmarkToggle}
      disabled={isLoading || disabled}
    >
      <Bookmark
        fill={isBookmarked ? "currentColor" : "none"}
        className={cn(isLoading && "animate-pulse")}
      />
    </Button>
  );
}
