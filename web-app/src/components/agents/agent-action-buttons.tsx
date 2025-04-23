"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import { AgentListWithAgent } from "@/lib/db";
import { cn } from "@/lib/utils";

import { AgentBookmarkButton } from "./agent-bookmark-button";

interface ActionButtonsProps {
  agentId: string;
  agentList?: AgentListWithAgent;
  className?: string;
}

export default function AgentActionButtons({
  agentId,
  agentList,
  className,
}: ActionButtonsProps) {
  const pathname = usePathname();
  const parentPath = pathname.split("/").slice(0, -1).join("/") || "/";

  const origin = window.location.origin;
  const url = new URL(`${origin}/agents/${agentId}`);
  return (
    <div className={cn("flex w-full items-center justify-between", className)}>
      <Link href={parentPath}>
        <Button size="icon">
          <ArrowLeft />
        </Button>
      </Link>
      <div className="flex items-center gap-2">
        {agentList && (
          <AgentBookmarkButton agentId={agentId} agentList={agentList} />
        )}
        <ShareButton url={url} />
      </div>
    </div>
  );
}
