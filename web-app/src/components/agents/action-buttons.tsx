"use client";

import { ArrowLeft, Share } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { AgentListWithAgent } from "@/lib/db";

import { AgentBookmarkButton } from "./agent-bookmark-button";

interface ActionButtonsProps {
  agentId: string;
  agentList?: AgentListWithAgent;
}

export default function ActionButtons({
  agentId,
  agentList,
}: ActionButtonsProps) {
  const t = useTranslations("Components.Agents.AgentDetail");
  const pathname = usePathname();
  const parentPath = pathname.split("/").slice(0, -1).join("/") || "/";

  return (
    <div className="flex w-full items-center justify-between">
      <Link href={parentPath}>
        <Button size="icon">
          <ArrowLeft />
        </Button>
      </Link>
      <div className="flex items-center gap-2">
        {agentList && (
          <AgentBookmarkButton agentId={agentId} agentList={agentList} />
        )}
        <Button variant="secondary" size="icon">
          <Share />
        </Button>
      </div>
    </div>
  );
}
