"use client";

import { SquareTerminal } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getAgentName } from "@/lib/db";
import { cn } from "@/lib/utils";
import { Agent } from "@/prisma/generated/client";

interface AgentListProps {
  groupKey: string;
  title: string;
  agents: Agent[];
  noAgentsType: string;
}

export default function AgentList({
  groupKey,
  title,
  agents,
  noAgentsType,
}: AgentListProps) {
  const t = useTranslations("App.Sidebar.Content.AgentsList");

  // [agentId] in params
  const { agentId } = useParams();

  return (
    <SidebarGroup key={groupKey} className="w-64">
      <SidebarGroupLabel className="text-base">{title}</SidebarGroupLabel>
      <SidebarGroupContent className="mt-2">
        {agents.length > 0 ? (
          <SidebarMenu>
            {agents.map((agent) => (
              <SidebarMenuItem key={agent.id}>
                <SidebarMenuButton
                  asChild
                  className={cn({
                    "bg-primary hover:bg-primary": agentId === agent.id,
                  })}
                >
                  <div className="group/agent-menu flex w-full items-center gap-2">
                    <SquareTerminal className="h-4 w-4" />
                    <Link
                      href={`/app/agents/${agent.id}/jobs`}
                      className="truncate"
                    >
                      {getAgentName(agent)}
                    </Link>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        ) : (
          <p className="text-muted-foreground px-3 text-sm">
            {t("noAgents", { type: noAgentsType })}
          </p>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
